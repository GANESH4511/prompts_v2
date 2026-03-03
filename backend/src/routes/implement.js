/**
 * POST /api/implement         — Generate diff preview (does NOT apply changes)
 * POST /api/implement/apply   — Apply confirmed changes to files
 * POST /api/implement/undo    — Rollback changes from backup
 * 
 * Uses the implement template to instruct the LLM to generate code
 * modifications from prompt descriptions.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generatePrompt, loadTemplate, getLatestVersion } = require('../llm');
const { prisma } = require('../lib/prisma');
const { resolveProjectRoot } = require('../lib/resolveProject');

const router = express.Router();

// In-memory session store for pending implementations
const pendingSessions = new Map();

const { parseWithRepair } = require('../lib/jsonRepair');

/**
 * Parse the LLM's JSON response, handling markdown fences, truncated output, and edge cases.
 * Uses the shared JSON repair utility for robust parsing.
 */
function parseLLMResponse(raw) {
    return parseWithRepair(raw);
}

/**
 * Build a simple line-based diff between old and new code.
 */
function buildDiff(oldCode, newCode) {
    const oldLines = oldCode.split('\n');
    const newLines = newCode.split('\n');
    const diff = [];
    const maxLen = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLen; i++) {
        const oldLine = i < oldLines.length ? oldLines[i] : undefined;
        const newLine = i < newLines.length ? newLines[i] : undefined;

        if (oldLine === undefined) {
            diff.push({ type: 'add', line: i + 1, content: newLine });
        } else if (newLine === undefined) {
            diff.push({ type: 'remove', line: i + 1, content: oldLine });
        } else if (oldLine !== newLine) {
            diff.push({ type: 'remove', line: i + 1, content: oldLine });
            diff.push({ type: 'add', line: i + 1, content: newLine });
        } else {
            diff.push({ type: 'unchanged', line: i + 1, content: oldLine });
        }
    }

    return diff;
}

/**
 * Apply oldCode→newCode replacement within a file's content.
 * If oldCode is found, replace it. Otherwise, return newCode as the full file.
 */
function applyPatch(fileContent, oldCode, newCode) {
    if (!oldCode || !oldCode.trim()) {
        // Pure addition — append at end
        return fileContent + '\n' + newCode;
    }

    // Normalize line endings for matching
    const normalizedContent = fileContent.replace(/\r\n/g, '\n');
    const normalizedOld = oldCode.replace(/\r\n/g, '\n');

    if (normalizedContent.includes(normalizedOld)) {
        return normalizedContent.replace(normalizedOld, newCode.replace(/\r\n/g, '\n'));
    }

    // Fallback: try trimmed matching (handles whitespace differences)
    const trimmedOld = normalizedOld.trim();
    const lines = normalizedContent.split('\n');
    const oldLines = trimmedOld.split('\n');

    // Find the starting line
    for (let i = 0; i <= lines.length - oldLines.length; i++) {
        let match = true;
        for (let j = 0; j < oldLines.length; j++) {
            if (lines[i + j].trim() !== oldLines[j].trim()) {
                match = false;
                break;
            }
        }
        if (match) {
            const before = lines.slice(0, i).join('\n');
            const after = lines.slice(i + oldLines.length).join('\n');
            return before + (before ? '\n' : '') + newCode.replace(/\r\n/g, '\n') + (after ? '\n' + after : '');
        }
    }

    // Last resort: the LLM might have returned the full file as newCode
    console.warn('  ⚠️ Could not find oldCode in file — using newCode as full replacement');
    return newCode.replace(/\r\n/g, '\n');
}

/**
 * Trigger the existing /api/seed pipeline internally.
 */
async function triggerSeed(projectId) {
    const port = process.env.PORT || 5000;
    const seedUrl = `http://localhost:${port}/api/seed`;

    console.log(`  🔄 Triggering seed for project: ${projectId || 'default'}...`);

    try {
        const response = await fetch(seedUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId })
        });

        if (!response.ok) {
            const body = await response.text();
            console.warn(`  ⚠️ Seed returned ${response.status}: ${body.substring(0, 200)}`);
            return { success: false, error: body };
        }

        const result = await response.json();
        console.log('  ✅ Seed completed successfully');
        return result;
    } catch (err) {
        console.warn(`  ⚠️ Seed failed: ${err.message}`);
        return { success: false, error: err.message };
    }
}


// ==========================================
// POST /api/implement — Generate diff preview
// ==========================================
router.post('/', async (req, res) => {
    const startTime = Date.now();

    try {
        const { pageId, promptContent, scope, additionalFiles } = req.body;

        if (!pageId) {
            return res.status(400).json({ success: false, error: 'pageId is required' });
        }
        if (!promptContent || !promptContent.trim()) {
            return res.status(400).json({ success: false, error: 'promptContent is required' });
        }

        console.log(`\n🚀 Implement Request`);
        console.log(`  📋 Page: ${pageId}`);
        console.log(`  📏 Prompt length: ${promptContent.length} chars`);
        console.log(`  🎯 Scope: ${scope || 'single'}`);

        // Step 1: Load page from DB
        const page = await prisma.page.findUnique({
            where: { id: pageId },
            select: { filePath: true, componentName: true, projectId: true }
        });

        if (!page) {
            return res.status(404).json({ success: false, error: 'Page not found' });
        }

        // Step 2: Resolve project root and read source code
        const resolved = await resolveProjectRoot({ projectId: page.projectId, pageId });
        const rootDir = resolved.rootDir;

        if (!rootDir) {
            return res.status(400).json({
                success: false,
                error: `No project found for this page. Please ensure it belongs to a registered project.`
            });
        }

        const absolutePath = path.join(rootDir, page.filePath.split('/').join(path.sep));

        if (!fs.existsSync(absolutePath)) {
            return res.status(404).json({
                success: false,
                error: `Source file not found: ${page.filePath}`
            });
        }

        const sourceCode = fs.readFileSync(absolutePath, 'utf-8');
        console.log(`  📄 Source: ${page.filePath} (${sourceCode.length} chars)`);

        // Step 3: Build context for the LLM
        // Include file structure info for multi-file awareness
        let fileStructureContext = '';
        if (scope === 'multi' || additionalFiles) {
            try {
                const allPages = await prisma.page.findMany({
                    where: page.projectId ? { projectId: page.projectId } : {},
                    select: { filePath: true, componentName: true, purpose: true }
                });
                fileStructureContext = '\n\nProject file structure:\n' +
                    allPages.map(p => `- ${p.filePath} (${p.componentName}): ${p.purpose}`).join('\n');
            } catch (e) {
                console.warn('  ⚠️ Could not load project file structure:', e.message);
            }
        }

        const userPrompt = `Current source code file: ${page.filePath}\n\n` +
            `--- SOURCE CODE ---\n${sourceCode}\n--- END SOURCE CODE ---\n\n` +
            `--- CHANGE REQUEST ---\n${promptContent}\n--- END CHANGE REQUEST ---` +
            fileStructureContext;

        // Step 4: Load implement template
        const implVersion = getLatestVersion('implement');
        const implTemplate = loadTemplate('implement', implVersion);
        console.log(`  📋 Implement template: v${implVersion} loaded`);

        // Step 5: Call LLM
        console.log(`  🤖 Generating code changes via LLM...`);
        const llmRaw = await generatePrompt({
            template: implTemplate.content,
            sourceCode: userPrompt,
            metadata: {
                templateType: 'implement',
                templateVersion: implVersion,
                filePath: page.filePath
            }
        });

        // Step 6: Parse LLM response
        const llmResponse = parseLLMResponse(llmRaw);
        console.log(`  📦 LLM returned: ${llmResponse.changes?.length || 0} changes, ${llmResponse.suggestedFiles?.length || 0} suggestions, ${llmResponse.newFiles?.length || 0} new files`);

        // Step 7: Build diffs for each change
        const diffs = [];

        // Process modifications
        if (llmResponse.changes && Array.isArray(llmResponse.changes)) {
            for (const change of llmResponse.changes) {
                const changePath = change.filePath || page.filePath;
                const changeAbsPath = path.isAbsolute(changePath)
                    ? changePath
                    : path.join(rootDir, changePath.split('/').join(path.sep));

                let currentCode = '';
                if (fs.existsSync(changeAbsPath)) {
                    currentCode = fs.readFileSync(changeAbsPath, 'utf-8');
                }

                // Apply the patch to get the new full file content
                const newFullCode = applyPatch(currentCode, change.oldCode, change.newCode);

                diffs.push({
                    filePath: changePath,
                    absolutePath: changeAbsPath,
                    action: 'modify',
                    description: change.description || 'Modified code',
                    oldCode: currentCode,
                    newCode: newFullCode,
                    diff: buildDiff(currentCode, newFullCode),
                    isNew: false
                });
            }
        }

        // Process new files
        if (llmResponse.newFiles && Array.isArray(llmResponse.newFiles)) {
            for (const newFile of llmResponse.newFiles) {
                const newFilePath = newFile.filePath;
                const newFileAbsPath = path.isAbsolute(newFilePath)
                    ? newFilePath
                    : path.join(rootDir, newFilePath.split('/').join(path.sep));

                diffs.push({
                    filePath: newFilePath,
                    absolutePath: newFileAbsPath,
                    action: 'create',
                    description: newFile.description || 'New file',
                    oldCode: '',
                    newCode: newFile.content,
                    diff: buildDiff('', newFile.content),
                    isNew: true
                });
            }
        }

        // Step 8: Create session
        const sessionId = crypto.randomUUID();
        pendingSessions.set(sessionId, {
            pageId,
            projectId: page.projectId,
            promptContent,
            scope: scope || 'single',
            diffs,
            rootDir,
            createdAt: Date.now()
        });

        // Clean up old sessions (older than 30 minutes)
        const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
        for (const [sid, session] of pendingSessions.entries()) {
            if (session.createdAt < thirtyMinAgo) {
                pendingSessions.delete(sid);
            }
        }

        const elapsed = Date.now() - startTime;
        console.log(`  ✅ Preview generated in ${elapsed}ms (${diffs.length} file(s) affected)\n`);

        res.json({
            success: true,
            sessionId,
            memory: llmResponse.memory || '',
            diffs: diffs.map(d => ({
                filePath: d.filePath,
                action: d.action,
                description: d.description,
                oldCode: d.oldCode,
                newCode: d.newCode,
                diff: d.diff,
                isNew: d.isNew
            })),
            suggestedFiles: llmResponse.suggestedFiles || [],
            elapsed: `${elapsed}ms`
        });

    } catch (error) {
        const elapsed = Date.now() - startTime;
        console.error(`  ❌ Implement preview failed (${elapsed}ms):`, error.message);

        const msg = error.message || '';
        let statusCode = 500;
        if (msg.includes('rate limit') || msg.includes('429')) statusCode = 429;
        else if (msg.includes('authentication') || msg.includes('API key')) statusCode = 401;
        else if (msg.includes('not found')) statusCode = 404;

        res.status(statusCode).json({
            success: false,
            error: msg.length > 300 ? msg.substring(0, 300) + '...' : msg,
            elapsed: `${elapsed}ms`
        });
    }
});


// ==========================================
// POST /api/implement/apply — Apply confirmed changes
// ==========================================
router.post('/apply', async (req, res) => {
    const startTime = Date.now();

    try {
        const { sessionId, selectedDiffs } = req.body;

        if (!sessionId) {
            return res.status(400).json({ success: false, error: 'sessionId is required' });
        }

        const session = pendingSessions.get(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, error: 'Session expired or not found. Please generate a new preview.' });
        }

        console.log(`\n✅ Implement Apply`);
        console.log(`  📋 Session: ${sessionId}`);

        // Use selectedDiffs if provided, otherwise apply all diffs from session
        const diffsToApply = selectedDiffs || session.diffs;
        const filesChanged = [];

        for (const diff of diffsToApply) {
            const absPath = diff.absolutePath || path.join(session.rootDir, diff.filePath.split('/').join(path.sep));

            if (diff.isNew || diff.action === 'create') {
                // Create new file
                const dir = path.dirname(absPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(absPath, diff.newCode, 'utf-8');
                console.log(`  🆕 Created: ${diff.filePath}`);

                filesChanged.push({
                    filePath: diff.filePath,
                    absolutePath: absPath,
                    backupPath: null,
                    action: 'create'
                });
            } else {
                // Modify existing file — create .bak backup first
                const backupPath = absPath + '.bak';
                if (fs.existsSync(absPath)) {
                    fs.copyFileSync(absPath, backupPath);
                    console.log(`  📦 Backup: ${backupPath}`);
                }

                fs.writeFileSync(absPath, diff.newCode, 'utf-8');
                console.log(`  ✏️ Modified: ${diff.filePath}`);

                filesChanged.push({
                    filePath: diff.filePath,
                    absolutePath: absPath,
                    backupPath,
                    action: 'modify'
                });
            }
        }

        // Save to ImplementHistory
        const history = await prisma.implementHistory.create({
            data: {
                pageId: session.pageId,
                projectId: session.projectId,
                promptContent: session.promptContent,
                scope: session.scope,
                filesChanged: JSON.stringify(filesChanged),
                status: 'applied'
            }
        });

        console.log(`  💾 History saved: ${history.id}`);

        // Trigger seed to sync DB
        const seedResult = await triggerSeed(session.projectId);

        // Clean up session
        pendingSessions.delete(sessionId);

        const elapsed = Date.now() - startTime;
        console.log(`  ⏱️ Applied in ${elapsed}ms\n`);

        res.json({
            success: true,
            historyId: history.id,
            filesChanged: filesChanged.length,
            elapsed: `${elapsed}ms`,
            seedResult: seedResult.success ? 'synced' : 'seed_warning'
        });

    } catch (error) {
        const elapsed = Date.now() - startTime;
        console.error(`  ❌ Implement apply failed (${elapsed}ms):`, error.message);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to apply changes',
            elapsed: `${elapsed}ms`
        });
    }
});


// ==========================================
// POST /api/implement/undo — Rollback changes
// ==========================================
router.post('/undo', async (req, res) => {
    const startTime = Date.now();

    try {
        const { historyId } = req.body;

        if (!historyId) {
            return res.status(400).json({ success: false, error: 'historyId is required' });
        }

        console.log(`\n↩️ Implement Undo`);
        console.log(`  📋 History: ${historyId}`);

        const history = await prisma.implementHistory.findUnique({
            where: { id: historyId }
        });

        if (!history) {
            return res.status(404).json({ success: false, error: 'History record not found' });
        }

        if (history.status === 'reverted') {
            return res.status(400).json({ success: false, error: 'This change has already been reverted' });
        }

        const filesChanged = JSON.parse(history.filesChanged);
        let restoredCount = 0;

        for (const file of filesChanged) {
            if (file.action === 'create') {
                // Delete newly created file
                if (fs.existsSync(file.absolutePath)) {
                    fs.unlinkSync(file.absolutePath);
                    console.log(`  🗑️ Deleted created file: ${file.filePath}`);
                    restoredCount++;
                }
            } else if (file.action === 'modify' && file.backupPath) {
                // Restore from backup
                if (fs.existsSync(file.backupPath)) {
                    fs.copyFileSync(file.backupPath, file.absolutePath);
                    fs.unlinkSync(file.backupPath); // Clean up backup
                    console.log(`  ↩️ Restored: ${file.filePath}`);
                    restoredCount++;
                } else {
                    console.warn(`  ⚠️ Backup not found: ${file.backupPath}`);
                }
            }
        }

        // Update history status
        await prisma.implementHistory.update({
            where: { id: historyId },
            data: { status: 'reverted' }
        });

        // Trigger seed to sync DB
        const seedResult = await triggerSeed(history.projectId);

        const elapsed = Date.now() - startTime;
        console.log(`  ⏱️ Undone in ${elapsed}ms (${restoredCount} file(s) restored)\n`);

        res.json({
            success: true,
            restoredFiles: restoredCount,
            elapsed: `${elapsed}ms`,
            seedResult: seedResult.success ? 'synced' : 'seed_warning'
        });

    } catch (error) {
        const elapsed = Date.now() - startTime;
        console.error(`  ❌ Implement undo failed (${elapsed}ms):`, error.message);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to undo changes',
            elapsed: `${elapsed}ms`
        });
    }
});


module.exports = router;
