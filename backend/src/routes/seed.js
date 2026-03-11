const express = require('express');
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { prisma } = require('../lib/prisma');
const { classifyByRules } = require('../llm/classifier');
const { resolveProjectRoot } = require('../lib/resolveProject');

const router = express.Router();

// Directories to skip while scanning
const SKIP_DIRS = new Set([
    'node_modules', '.next', '.git', 'prompts', 'prompts1',
    '.dockerignore', 'public', '.vercel', 'dist', 'build', '__pycache__',
    'coverage', '.cache', '.turbo', '.swc', '.output'
]);

// Files to skip (non-modifiable defaults)
const SKIP_FILES = new Set([
    'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'tsconfig.json', 'tsconfig.tsbuildinfo', 'next-env.d.ts',
    'next.config.ts', 'next.config.js', 'next.config.mjs',
    'postcss.config.mjs', 'postcss.config.js',
    'tailwind.config.js', 'tailwind.config.ts',
    'jsconfig.json', '.eslintrc.js', '.eslintrc.json',
    '.prettierrc', '.prettierrc.js', 'babel.config.js',
    'jest.config.js', 'jest.config.ts', 'vite.config.js', 'vite.config.ts',
    '.gitignore', '.env', '.env.local', '.env.development', '.env.production',
    'README.md', 'LICENSE', 'Dockerfile', 'docker-compose.yml',
    'nodemon.json', 'vercel.json', 'fly.toml'
]);

// Code file extensions to pick up
const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

// Prompt file extension
const PROMPT_EXTENSION = '.txt';

// ==========================================
// File scanning helpers
// ==========================================

/**
 * Recursively find ALL files (code + prompts) in the project root directories.
 * Returns { codeFiles: string[], promptFiles: string[] }
 */
function scanProjectFiles(rootDir) {
    const codeFiles = [];
    const promptFiles = [];

    function walk(dir) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
                        walk(fullPath);
                    }
                } else if (entry.isFile()) {
                    if (SKIP_FILES.has(entry.name)) continue;

                    const ext = path.extname(entry.name).toLowerCase();
                    if (CODE_EXTENSIONS.has(ext)) {
                        codeFiles.push(fullPath);
                    } else if (ext === PROMPT_EXTENSION) {
                        promptFiles.push(fullPath);
                    }
                }
            }
        } catch (e) {
            console.error(`Error scanning directory ${dir}:`, e.message);
        }
    }

    walk(rootDir);
    return { codeFiles, promptFiles };
}

/**
 * For a given prompt file, derive the target code file path
 */
function deriveCodeFileFromPrompt(promptFilePath, codeFiles) {
    const baseName = promptFilePath.replace(/\.txt$/, '');
    for (const ext of CODE_EXTENSIONS) {
        const candidate = baseName + ext;
        if (codeFiles.includes(candidate)) {
            return candidate;
        }
    }
    return baseName + '.js';
}

/**
 * Read file content safely (async)
 */
async function readFileSafe(filePath) {
    try {
        return await fsPromises.readFile(filePath, 'utf-8');
    } catch {
        return null;
    }
}

/**
 * Get file stat safely (async)
 */
async function statSafe(filePath) {
    try {
        return await fsPromises.stat(filePath);
    } catch {
        return null;
    }
}

/**
 * Compute SHA-256 hash of content (first 16 chars)
 */
function contentHash(content) {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

// ==========================================
// Prompt file parsing
// ==========================================

function parsePromptFile(content) {
    const lines = content.split('\n');
    const sections = [];

    let currentSection = null;
    let currentPrompts = [];
    let inCodeBlock = false;

    const isSkipLine = (line) => {
        if (!line || line.length === 0) return true;
        if (/^[=\-\*_]{3,}$/.test(line)) return true;
        // Skip single-hash headings but NOT if they are SECTION headers
        if ((/^#[^#]/.test(line) || line === '#') && !/^#{1,3}\s*(?:SECTION|Section)\s*\d+/i.test(line)) return true;
        return false;
    };

    const isHeadingLine = (line) => {
        return /^[A-Z][A-Z\s]+:$/.test(line) || /^[A-Z][A-Z\s]+:\s*$/.test(line);
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            continue;
        }

        if (inCodeBlock) continue;

        // Detect Section Header (handles optional markdown # prefixes)
        const sectionMatch = line.match(/^(?:#{1,3}\s*)?(?:SECTION|Section)\s*(\d+)[:.]?\s*(.*)$/i);

        if (sectionMatch) {
            if (currentSection) {
                sections.push({
                    ...currentSection,
                    prompts: currentPrompts
                });
            }

            const rawName = sectionMatch[2].trim();
            let name = rawName;
            let start = i + 1;

            let end = lines.length;
            for (let j = i + 1; j < lines.length; j++) {
                if (/^(?:#{1,3}\s*)?(?:SECTION|Section)\s*\d+[:.]?\s*/i.test(lines[j].trim())) {
                    end = j;
                    break;
                }
            }

            const linesMatch = rawName.match(/(.*?)\s*\(Lines\s*(\d+)-(\d+)\)$/i);
            if (linesMatch) {
                name = linesMatch[1].trim();
                start = parseInt(linesMatch[2]);
                end = parseInt(linesMatch[3]);
            }

            currentSection = {
                name,
                startLine: start,
                endLine: end,
                purpose: 'Section Purpose'
            };
            currentPrompts = [];
            continue;
        }

        if (currentSection) {
            if (line.toLowerCase().startsWith('purpose:')) {
                currentSection.purpose = line.substring(8).trim();
                continue;
            }

            // NLP Prompts
            if (line.match(/^NLP_PROMPT:/i)) {
                const template = line.replace(/^NLP_PROMPT:/i, '').trim().replace(/^"|"$/g, '');
                let example = '';
                if (i + 1 < lines.length && lines[i + 1].trim().match(/^EXAMPLE:/i)) {
                    example = lines[i + 1].trim().replace(/^EXAMPLE:/i, '').trim().replace(/^"|"$/g, '');
                }
                currentPrompts.push({ template, example, lineNumber: i + 1, promptType: 'NLP' });
                continue;
            }

            // Developer Prompts
            if (line.match(/^DEV_PROMPT:/i)) {
                const template = line.replace(/^DEV_PROMPT:/i, '').trim().replace(/^"|"$/g, '');
                let example = '';
                if (i + 1 < lines.length && lines[i + 1].trim().match(/^EXAMPLE:/i)) {
                    example = lines[i + 1].trim().replace(/^EXAMPLE:/i, '').trim().replace(/^"|"$/g, '');
                }
                currentPrompts.push({ template, example, lineNumber: i + 1, promptType: 'DEVELOPER' });
                continue;
            }

            // Legacy PROMPT/TEMPLATE
            if (line.match(/^(PROMPT|TEMPLATE):/i)) {
                const template = line.replace(/^(PROMPT|TEMPLATE):/i, '').trim().replace(/^"|"$/g, '');
                let example = '';
                if (i + 1 < lines.length && lines[i + 1].trim().match(/^EXAMPLE:/i)) {
                    example = lines[i + 1].trim().replace(/^EXAMPLE:/i, '').trim().replace(/^"|"$/g, '');
                }
                currentPrompts.push({ template, example, lineNumber: i + 1, promptType: 'NLP' });
                continue;
            }

            if (isSkipLine(line)) continue;

            // Numbered items
            const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/);
            if (numberedMatch) {
                let template = numberedMatch[2].trim();
                let details = [];
                let j = i + 1;
                while (j < lines.length) {
                    const nextLine = lines[j].trim();
                    if (/^\d+\.\s+/.test(nextLine) || /^(?:SECTION|Section)\s*\d+/i.test(nextLine)) break;
                    if (isHeadingLine(nextLine)) break;
                    if (nextLine.startsWith('-') || nextLine.startsWith('•')) {
                        details.push(nextLine.replace(/^[\-•]\s*/, ''));
                    }
                    j++;
                }
                if (details.length > 0) {
                    template = `${template}: ${details.join('; ')}`;
                }
                currentPrompts.push({ template, example: '', lineNumber: i + 1, promptType: 'NLP' });
                continue;
            }

            // Action items (► > etc.)
            const actionMatch = line.match(/^[►>]\s+(.+)$/);
            if (actionMatch) {
                let template = actionMatch[1].trim();
                let details = [];
                let j = i + 1;
                while (j < lines.length && j < i + 5) {
                    const nextLine = lines[j].trim();
                    if (/^[►>]\s+/.test(nextLine) || /^(?:SECTION|Section)\s*\d+/i.test(nextLine)) break;
                    if (/^\d+\.\s+/.test(nextLine)) break;
                    if (nextLine.startsWith('-') && !nextLine.startsWith('---')) {
                        details.push(nextLine.replace(/^-\s*/, ''));
                    }
                    j++;
                }
                if (details.length > 0) {
                    template = `${template} ${details.join(' | ')}`;
                }
                currentPrompts.push({ template, example: '', lineNumber: i + 1, promptType: 'NLP' });
                continue;
            }

            // Table rows
            if (line.startsWith('|') && line.endsWith('|') && !line.match(/^\|[\-\s\|]+\|$/)) {
                const cells = line.split('|').filter(c => c.trim());
                if (cells.length >= 2 && cells[0].trim() && !/^[\-\s]+$/.test(cells[0])) {
                    currentPrompts.push({
                        template: cells.map(c => c.trim()).join(' | '),
                        example: '',
                        lineNumber: i + 1,
                        promptType: 'DEVELOPER'
                    });
                }
                continue;
            }

            // ### headings
            const topicMatch = line.match(/^###?\s+(.+)$/);
            if (topicMatch) {
                let template = topicMatch[1].trim();
                let details = [];
                let j = i + 1;
                while (j < lines.length && j < i + 10) {
                    const nextLine = lines[j].trim();
                    if (/^###?\s+/.test(nextLine)) break;
                    if (/^(?:SECTION|Section)\s*\d+/i.test(nextLine)) break;
                    if (nextLine && !isSkipLine(nextLine) && !nextLine.startsWith('```')) {
                        if (details.length < 3) details.push(nextLine);
                    }
                    j++;
                }
                currentPrompts.push({
                    template,
                    example: details.length > 0 ? details[0] : '',
                    lineNumber: i + 1,
                    promptType: 'DEVELOPER'
                });
                continue;
            }

            // All-caps heading
            const capsHeadingMatch = line.match(/^([A-Z][A-Z\s]+):$/);
            if (capsHeadingMatch && !/^(PURPOSE|SECTION|IMPORTS|FILE|END):/i.test(line)) {
                currentPrompts.push({
                    template: capsHeadingMatch[1].trim(),
                    example: '',
                    lineNumber: i + 1,
                    promptType: 'NLP'
                });
                continue;
            }
        }
    }

    if (currentSection) {
        sections.push({
            ...currentSection,
            prompts: currentPrompts
        });
    }

    return sections;
}

// ==========================================
// Incremental upsert for a single page
// ==========================================

/**
 * Upsert a single page with its sections and prompts.
 * Deletes old sections/prompts via cascade, then recreates.
 */
async function upsertPage({ projectId, relPath, componentName, totalLines, purpose, category, promptFilePath, rawContent, hash, mtime, sections }) {
    // Try to find existing page
    const existing = await prisma.page.findUnique({
        where: { projectId_filePath: { projectId, filePath: relPath } }
    });

    if (existing) {
        // Delete old sections (cascade deletes prompts too)
        await prisma.section.deleteMany({ where: { pageId: existing.id } });

        // Update page + recreate sections
        await prisma.page.update({
            where: { id: existing.id },
            data: {
                componentName,
                totalLines,
                purpose,
                category,
                promptFilePath,
                rawContent,
                contentHash: hash,
                fileMtime: mtime,
                sections: {
                    create: sections.map(s => ({
                        name: s.name,
                        startLine: s.startLine,
                        endLine: s.endLine,
                        purpose: s.purpose,
                        prompts: {
                            create: s.prompts.map(p => ({
                                template: p.template,
                                example: p.example,
                                lineNumber: p.lineNumber,
                                promptType: p.promptType || 'NLP'
                            }))
                        }
                    }))
                }
            }
        });
    } else {
        await prisma.page.create({
            data: {
                filePath: relPath,
                componentName,
                totalLines,
                purpose,
                category,
                promptFilePath,
                rawContent,
                contentHash: hash,
                fileMtime: mtime,
                projectId,
                sections: {
                    create: sections.map(s => ({
                        name: s.name,
                        startLine: s.startLine,
                        endLine: s.endLine,
                        purpose: s.purpose,
                        prompts: {
                            create: s.prompts.map(p => ({
                                template: p.template,
                                example: p.example,
                                lineNumber: p.lineNumber,
                                promptType: p.promptType || 'NLP'
                            }))
                        }
                    }))
                }
            }
        });
    }
}

// ==========================================
// Core seed logic — INCREMENTAL
// Only processes files whose mtime/hash changed since last sync.
// Uses rule-based classification (no LLM call) for speed.
// ==========================================
async function seedProject(rootDir, projectId) {
    const startTime = Date.now();
    console.log(`\n🔄 Starting incremental sync...`);
    console.log(`📁 Root: ${rootDir}`);

    if (!fs.existsSync(rootDir)) {
        throw new Error(`Root directory not found: ${rootDir}`);
    }

    // 1. Scan disk
    const { codeFiles, promptFiles } = scanProjectFiles(rootDir);
    console.log(`📂 Disk: ${codeFiles.length} code, ${promptFiles.length} prompt files`);

    // 2. Load existing DB pages for this project (for dirty checking)
    const existingPages = await prisma.page.findMany({
        where: { projectId },
        select: { id: true, filePath: true, contentHash: true, fileMtime: true, promptFilePath: true }
    });
    const dbPageMap = new Map(existingPages.map(p => [p.filePath, p]));

    // 3. Build disk file map: relPath -> { promptAbsPath, codeAbsPath }
    const diskMap = new Map(); // relPath -> { promptAbsPath?, codeAbsPath? }
    const promptFileSet = new Set(promptFiles);

    for (const pf of promptFiles) {
        const fileName = path.basename(pf);
        // Skip MASTER prompts (table dropped)
        const content = await readFileSafe(pf);
        if (!content) continue;
        if (fileName.includes('MASTER') || content.includes('MASTER NLP PROMPT')) continue;

        const matchingCodeFile = deriveCodeFileFromPrompt(pf, codeFiles);
        const relPath = path.relative(rootDir, matchingCodeFile).replace(/\\/g, '/');

        diskMap.set(relPath, {
            promptAbsPath: pf,
            codeAbsPath: fs.existsSync(matchingCodeFile) ? matchingCodeFile : null,
            promptContent: content
        });
    }

    for (const cf of codeFiles) {
        const relPath = path.relative(rootDir, cf).replace(/\\/g, '/');
        if (!diskMap.has(relPath)) {
            diskMap.set(relPath, { promptAbsPath: null, codeAbsPath: cf, promptContent: null });
        } else {
            // Code file exists for a prompt we already tracked — fill in codeAbsPath
            const entry = diskMap.get(relPath);
            if (!entry.codeAbsPath) entry.codeAbsPath = cf;
        }
    }

    // 4. Determine dirty files (new, modified, removed)
    const toUpsert = []; // relPaths that need processing
    const toRemove = []; // DB page IDs that are gone from disk
    let skippedCount = 0;

    for (const [relPath, diskEntry] of diskMap) {
        const dbPage = dbPageMap.get(relPath);

        if (!dbPage) {
            // New file — must process
            toUpsert.push(relPath);
            continue;
        }

        // Check if prompt file changed (mtime-based dirty check)
        if (diskEntry.promptAbsPath) {
            const stat = await statSafe(diskEntry.promptAbsPath);
            if (stat) {
                const diskMtime = stat.mtime;
                const dbMtime = dbPage.fileMtime ? new Date(dbPage.fileMtime) : null;

                if (!dbMtime || diskMtime > dbMtime) {
                    // File modified — need to re-parse
                    toUpsert.push(relPath);
                    continue;
                }

                // Double-check with content hash if mtime matches
                if (diskEntry.promptContent) {
                    const hash = contentHash(diskEntry.promptContent);
                    if (hash !== dbPage.contentHash) {
                        toUpsert.push(relPath);
                        continue;
                    }
                }
            }
        } else if (diskEntry.codeAbsPath) {
            // Code-only file — check if code file mtime changed
            const stat = await statSafe(diskEntry.codeAbsPath);
            if (stat) {
                const dbMtime = dbPage.fileMtime ? new Date(dbPage.fileMtime) : null;
                if (!dbMtime || stat.mtime > dbMtime) {
                    toUpsert.push(relPath);
                    continue;
                }
            }
        }

        // File unchanged — skip
        skippedCount++;
    }

    // Find removed files (in DB but not on disk)
    for (const [relPath, dbPage] of dbPageMap) {
        if (!diskMap.has(relPath)) {
            toRemove.push(dbPage.id);
        }
    }

    console.log(`🔍 ${toUpsert.length} dirty, ${skippedCount} unchanged, ${toRemove.length} removed`);

    // 5. Remove stale pages
    if (toRemove.length > 0) {
        await prisma.page.deleteMany({ where: { id: { in: toRemove } } });
        console.log(`🗑️  Deleted ${toRemove.length} stale pages`);
    }

    // 6. Upsert dirty files
    const processed = [];

    for (const relPath of toUpsert) {
        const diskEntry = diskMap.get(relPath);
        const fileName = path.basename(relPath);
        const componentName = fileName.replace(/\.(js|jsx|ts|tsx)$/, '');
        const fileCategory = classifyByRules(relPath);

        if (diskEntry.promptContent) {
            // Has prompt file — parse sections
            const sections = parsePromptFile(diskEntry.promptContent);
            const hash = contentHash(diskEntry.promptContent);
            const stat = await statSafe(diskEntry.promptAbsPath);
            const mtime = stat ? stat.mtime : null;

            let totalLines = 0;
            if (diskEntry.codeAbsPath) {
                const codeContent = await readFileSafe(diskEntry.codeAbsPath);
                if (codeContent) totalLines = codeContent.split(/\r\n|\r|\n/).length;
            }

            await upsertPage({
                projectId,
                relPath,
                componentName,
                totalLines,
                purpose: `Prompt file for ${fileName}`,
                category: fileCategory,
                promptFilePath: diskEntry.promptAbsPath,
                rawContent: diskEntry.promptContent,
                hash,
                mtime,
                sections
            });

            processed.push({ file: fileName, type: 'page', target: relPath, sections: sections.length, category: fileCategory });
        } else {
            // Code-only file — no sections
            const codeContent = await readFileSafe(diskEntry.codeAbsPath);
            const totalLines = codeContent ? codeContent.split(/\r\n|\r|\n/).length : 0;
            const stat = await statSafe(diskEntry.codeAbsPath);
            const mtime = stat ? stat.mtime : null;
            const hash = codeContent ? contentHash(codeContent) : null;
            const folderPath = relPath.substring(0, relPath.lastIndexOf('/')) || 'root';

            await upsertPage({
                projectId,
                relPath,
                componentName,
                totalLines,
                purpose: `Source code: ${folderPath}/${fileName}`,
                category: fileCategory,
                promptFilePath: null,
                rawContent: null,
                hash,
                mtime,
                sections: []
            });

            processed.push({ file: fileName, type: 'code', target: relPath, sections: 0, category: fileCategory });
        }
    }

    const elapsed = Date.now() - startTime;
    const catCounts = { FRONTEND: 0, BACKEND: 0, DATABASE: 0 };
    processed.forEach(p => { if (p.category) catCounts[p.category]++; });

    console.log(`✅ Sync done in ${elapsed}ms — ${processed.length} upserted, ${skippedCount} skipped, ${toRemove.length} removed`);

    return {
        success: true,
        processed,
        summary: {
            total: diskMap.size,
            upserted: processed.length,
            skipped: skippedCount,
            removed: toRemove.length,
            categories: catCounts,
            elapsed: `${elapsed}ms`
        }
    };
}

// ==========================================
// Targeted single-page re-seed (for use after generate/implement)
// ==========================================
async function seedSinglePage(rootDir, projectId, relFilePath) {
    const absCodePath = path.join(rootDir, relFilePath.split('/').join(path.sep));
    const absPromptPath = absCodePath.replace(/\.(js|jsx|ts|tsx)$/, '.txt');

    const fileName = path.basename(relFilePath);
    const componentName = fileName.replace(/\.(js|jsx|ts|tsx)$/, '');
    const category = classifyByRules(relFilePath);

    const promptContent = await readFileSafe(absPromptPath);
    const codeContent = await readFileSafe(absCodePath);
    const totalLines = codeContent ? codeContent.split(/\r\n|\r|\n/).length : 0;

    let sections = [];
    let hash = null;
    let mtime = null;
    let rawContent = null;
    let promptFilePath = null;

    if (promptContent) {
        sections = parsePromptFile(promptContent);
        hash = contentHash(promptContent);
        const stat = await statSafe(absPromptPath);
        mtime = stat ? stat.mtime : null;
        rawContent = promptContent;
        promptFilePath = absPromptPath;
    } else if (codeContent) {
        hash = contentHash(codeContent);
        const stat = await statSafe(absCodePath);
        mtime = stat ? stat.mtime : null;
    }

    const folderPath = relFilePath.substring(0, relFilePath.lastIndexOf('/')) || 'root';

    await upsertPage({
        projectId,
        relPath: relFilePath,
        componentName,
        totalLines,
        purpose: promptContent ? `Prompt file for ${fileName}` : `Source code: ${folderPath}/${fileName}`,
        category,
        promptFilePath,
        rawContent,
        hash,
        mtime,
        sections
    });

    return { success: true, filePath: relFilePath, sections: sections.length };
}

// ==========================================
// POST seed database - Sync All Prompts
// ==========================================
router.post('/', async (req, res) => {
    try {
        const { projectId } = req.body || {};

        if (!projectId) {
            return res.status(400).json({
                error: 'projectId is required. Please select a project first.'
            });
        }

        const resolved = await resolveProjectRoot({ projectId });
        const rootDir = resolved.rootDir;

        if (!rootDir) {
            return res.status(404).json({ error: 'Project not found or has no path configured.' });
        }

        const result = await seedProject(rootDir, projectId);
        res.json(result);
    } catch (error) {
        console.error('Seed error:', error);
        res.status(500).json({ error: 'Failed to seed database', details: error.message });
    }
});

// ==========================================
// GET /check-sync - Check if root folder is in sync with DB
// ==========================================
router.get('/check-sync', async (req, res) => {
    try {
        const { projectId } = req.query;

        if (!projectId) {
            return res.json({
                success: true,
                inSync: true,
                message: 'No project specified',
                details: { newFiles: [], removedFiles: [], modifiedFiles: [] }
            });
        }

        const resolved = await resolveProjectRoot({ projectId });
        const rootDir = resolved.rootDir;

        if (!rootDir) {
            return res.json({
                success: true,
                inSync: false,
                message: 'Project not found',
                details: { newFiles: [], removedFiles: [], modifiedFiles: [] }
            });
        }

        if (!fs.existsSync(rootDir)) {
            return res.json({
                success: true,
                inSync: false,
                message: 'Root directory not found',
                details: { newFiles: [], removedFiles: [], modifiedFiles: [] }
            });
        }

        const { codeFiles, promptFiles } = scanProjectFiles(rootDir);

        const diskPaths = new Set();
        for (const pf of promptFiles) {
            const matchingCodeFile = deriveCodeFileFromPrompt(pf, codeFiles);
            diskPaths.add(path.relative(rootDir, matchingCodeFile).replace(/\\/g, '/'));
        }
        for (const cf of codeFiles) {
            diskPaths.add(path.relative(rootDir, cf).replace(/\\/g, '/'));
        }

        const dbPages = await prisma.page.findMany({
            where: { projectId },
            select: { filePath: true, fileMtime: true, promptFilePath: true }
        });
        const dbPaths = new Map(dbPages.map(p => [p.filePath, p]));

        const newFiles = [];
        const removedFiles = [];
        const modifiedFiles = [];

        for (const diskPath of diskPaths) {
            if (!dbPaths.has(diskPath)) {
                newFiles.push(diskPath);
            }
        }

        for (const [dbPath] of dbPaths) {
            if (!diskPaths.has(dbPath)) {
                removedFiles.push(dbPath);
            }
        }

        for (const [filePath, dbPage] of dbPaths) {
            if (!diskPaths.has(filePath)) continue;
            if (dbPage.promptFilePath) {
                const stat = await statSafe(dbPage.promptFilePath);
                if (stat) {
                    const dbMtime = dbPage.fileMtime ? new Date(dbPage.fileMtime) : null;
                    if (!dbMtime || stat.mtime > dbMtime) {
                        modifiedFiles.push(filePath);
                    }
                }
            }
        }

        const totalChanges = newFiles.length + removedFiles.length + modifiedFiles.length;
        const inSync = totalChanges === 0;

        let message = '';
        if (inSync) {
            message = 'Everything is in sync';
        } else {
            const parts = [];
            if (newFiles.length > 0) parts.push(`${newFiles.length} new`);
            if (modifiedFiles.length > 0) parts.push(`${modifiedFiles.length} modified`);
            if (removedFiles.length > 0) parts.push(`${removedFiles.length} removed`);
            message = `Changes: ${parts.join(', ')}`;
        }

        res.json({ success: true, inSync, totalChanges, message, details: { newFiles, removedFiles, modifiedFiles } });
    } catch (error) {
        console.error('Check-sync error:', error);
        res.status(500).json({ success: false, inSync: true, message: 'Failed to check sync status' });
    }
});

module.exports = router;
module.exports.seedProject = seedProject;
module.exports.seedSinglePage = seedSinglePage;
