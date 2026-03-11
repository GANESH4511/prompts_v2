/**
 * POST /api/generate-prompts
 * 
 * Generate NLP and Developer prompts from source code using LLM.
 * 
 * Input: { projectId, filePath }
 * 
 * Execution order:
 * 1. Read source code file from disk
 * 2. Load NLP template file
 * 3. Load Developer template file
 * 4. Call generatePrompt() for NLP template
 * 5. Call generatePrompt() for Developer template
 * 6. Combine into single .txt using existing delimiters
 * 7. DELETE old prompt .txt file from source directory
 * 8. Write new prompt .txt file atomically next to source file
 * 9. Trigger /api/seed to sync database
 * 10. Respond only after seed completes
 */

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { generatePrompt, loadTemplate, getLatestVersion } = require('../llm');
const { prisma } = require('../lib/prisma');
const { resolveProjectRoot } = require('../lib/resolveProject');
const { seedSinglePage } = require('./seed');

const router = express.Router();

/**
 * Combine NLP and Developer output into a single .txt file
 * using the existing prompt file delimiter format.
 */
function buildPromptFileContent({ fileName, nlpOutput, devOutput, nlpVersion, devVersion }) {
    const lines = [];

    lines.push('================================================================================');
    lines.push(`              GENERATED PROMPT (${fileName})`);
    lines.push('================================================================================');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`NLP Template: nlp/${nlpVersion}`);
    lines.push(`Developer Template: developer/${devVersion}`);
    lines.push('');
    lines.push('================================================================================');
    lines.push('SECTION 1: NLP (USER-DEFINED) - Context & Behavior');
    lines.push('================================================================================');
    lines.push('');
    lines.push(nlpOutput.trim());
    lines.push('');
    lines.push('================================================================================');
    lines.push('SECTION 2: DEVELOPER PROMPTS - Technical & Precise');
    lines.push('================================================================================');
    lines.push('');
    lines.push(devOutput.trim());
    lines.push('');
    lines.push('================================================================================');
    lines.push('                              END OF PROMPT');
    lines.push('================================================================================');
    lines.push('');

    return lines.join('\n');
}

/**
 * Helper to check if file exists (async)
 */
async function fileExists(p) {
    try { await fs.access(p); return true; } catch { return false; }
}

router.post('/', async (req, res) => {
    const startTime = Date.now();

    try {
        const { projectId, filePath } = req.body;

        // --- Validate input ---
        if (!filePath) {
            return res.status(400).json({
                success: false,
                error: 'filePath is required'
            });
        }

        console.log(`\n🧠 Generate Prompts Request`);
        console.log(`  📂 Project: ${projectId || 'default'}`);
        console.log(`  📄 File: ${filePath}`);

        // --- Step 1: Resolve project root dynamically from DB ---
        const resolved = await resolveProjectRoot({ projectId, filePath });
        const resolvedRoot = resolved.rootDir;
        const effectiveProjectId = resolved.projectId || projectId;

        if (!resolvedRoot) {
            return res.status(400).json({
                success: false,
                error: `No project found for file: ${filePath}. Please ensure the file belongs to a registered project.`
            });
        }

        console.log(`  📁 Resolved project root: ${resolvedRoot}`);

        let absoluteSourcePath;

        // If filePath is already absolute
        if (path.isAbsolute(filePath)) {
            absoluteSourcePath = filePath;
        } else {
            // Relative to resolved project root
            absoluteSourcePath = path.join(resolvedRoot, filePath.split('/').join(path.sep));
        }

        if (!(await fileExists(absoluteSourcePath))) {
            return res.status(404).json({
                success: false,
                error: `Source file not found: ${filePath}`,
                resolvedPath: absoluteSourcePath
            });
        }

        const sourceCode = await fs.readFile(absoluteSourcePath, 'utf-8');
        if (!sourceCode.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Source file is empty'
            });
        }

        const sourceHash = crypto.createHash('sha256').update(sourceCode).digest('hex').substring(0, 12);
        console.log(`  📊 Source: ${sourceCode.length} chars, hash=${sourceHash}`);

        // --- Step 2: Load NLP template ---
        const nlpVersion = getLatestVersion('nlp');
        const nlpTemplate = loadTemplate('nlp', nlpVersion);
        console.log(`  📋 NLP template: v${nlpVersion} loaded`);

        // --- Step 3: Load Developer template ---
        const devVersion = getLatestVersion('developer');
        const devTemplate = loadTemplate('developer', devVersion);
        console.log(`  📋 Developer template: v${devVersion} loaded`);

        // --- Step 4+5: Generate NLP and Developer prompts in parallel ---
        console.log(`  🤖 Generating NLP + Developer prompts in parallel...`);
        const [nlpOutput, devOutput] = await Promise.all([
            generatePrompt({
                template: nlpTemplate.content,
                sourceCode,
                metadata: { templateType: 'nlp', templateVersion: nlpVersion, filePath }
            }),
            generatePrompt({
                template: devTemplate.content,
                sourceCode,
                metadata: { templateType: 'developer', templateVersion: devVersion, filePath }
            })
        ]);

        // --- Step 6: Combine into .txt using existing delimiters ---
        const fileName = path.basename(absoluteSourcePath);
        const promptContent = buildPromptFileContent({
            fileName,
            nlpOutput,
            devOutput,
            nlpVersion,
            devVersion
        });

        // --- Step 7: Determine prompt file path ---
        const sourceDir = path.dirname(absoluteSourcePath);
        const baseName = path.basename(absoluteSourcePath, path.extname(absoluteSourcePath));
        const promptFilePath = path.join(sourceDir, `${baseName}.txt`);
        const tmpFilePath = promptFilePath + '.tmp';

        // Log whether this is a new prompt or an overwrite
        const exists = await fileExists(promptFilePath);
        console.log(exists
            ? `  📝 Existing prompt — will overwrite: ${promptFilePath}`
            : `  🆕 Creating new prompt: ${promptFilePath}`);

        // Clean up any stale .tmp file
        try { await fs.unlink(tmpFilePath); } catch {}

        // --- Step 8: Write new prompt file (atomic: write tmp then rename) ---
        await fs.writeFile(tmpFilePath, promptContent, 'utf-8');
        await fs.rename(tmpFilePath, promptFilePath);

        const outputHash = crypto.createHash('sha256').update(promptContent).digest('hex').substring(0, 12);
        console.log(`  💾 Written: ${promptFilePath}`);
        console.log(`  📊 Output: ${promptContent.length} chars, hash=${outputHash}`);

        // --- Step 9: Targeted single-page re-seed (direct fn call, no HTTP) ---
        const relFilePath = path.relative(resolvedRoot, absoluteSourcePath).replace(/\\/g, '/');
        const seedResult = await seedSinglePage(resolvedRoot, effectiveProjectId, relFilePath);

        // --- Step 10: Respond ---
        const elapsed = Date.now() - startTime;
        console.log(`  ⏱️  Total: ${elapsed}ms\n`);

        res.json({
            success: true,
            promptFilePath: path.relative(resolvedRoot, promptFilePath).replace(/\\/g, '/'),
            absolutePromptPath: promptFilePath,
            sourceFile: filePath,
            sourceHash,
            outputHash,
            templateVersions: {
                nlp: nlpVersion,
                developer: devVersion
            },
            provider: (process.env.LLM_PROVIDER || 'infinitai').toLowerCase(),
            model: process.env.INFINITAI_MODEL || 'meta-llama/Llama-3.2-11B-Vision-Instruct',
            elapsed: `${elapsed}ms`,
            seedResult: seedResult || null
        });

    } catch (error) {
        const elapsed = Date.now() - startTime;
        console.error(`  ❌ Generate failed (${elapsed}ms):`, error.message);

        // Clean up temp file if it exists (best-effort)
        try {
            const { filePath } = req.body || {};
            if (filePath && path.isAbsolute(filePath)) {
                const sourceDir = path.dirname(filePath);
                const baseName = path.basename(filePath, path.extname(filePath));
                const tmpPath = path.join(sourceDir, `${baseName}.txt.tmp`);
                await fs.unlink(tmpPath).catch(() => {});
            }
        } catch (cleanupErr) {
            // Ignore cleanup errors
        }

        // Classify the error for proper response
        const msg = error.message || '';
        let statusCode = 500;
        let errorCategory = 'generation_failed';
        let userMessage = 'An unexpected error occurred while generating prompts. Please try again.';

        if (msg.includes('rate limit') || msg.includes('429') || msg.includes('quota')) {
            statusCode = 429;
            errorCategory = 'rate_limit';
            userMessage = msg; // Already cleaned by infinitai.js
        } else if (msg.includes('invalid') || msg.includes('unauthorized') || msg.includes('API key')) {
            statusCode = 401;
            errorCategory = 'auth_error';
            userMessage = msg;
        } else if (msg.includes('not found') || msg.includes('not exist')) {
            statusCode = 404;
            errorCategory = 'not_found';
            userMessage = msg;
        } else if (msg.includes('empty')) {
            statusCode = 400;
            errorCategory = 'empty_source';
            userMessage = msg;
        } else if (msg.includes('Template')) {
            statusCode = 500;
            errorCategory = 'template_error';
            userMessage = 'Prompt template not found. Please ensure templates are configured correctly.';
        } else if (msg.includes('Seed failed')) {
            statusCode = 500;
            errorCategory = 'seed_error';
            userMessage = 'Prompts were generated successfully, but syncing the database failed. Try clicking "Sync All Prompts".';
        } else if (msg.includes('INFINITAI_API_KEY') || msg.includes('INFINITAI_BASE_URL') || msg.includes('INFINITAI_MODEL')) {
            statusCode = 500;
            errorCategory = 'config_error';
            userMessage = 'InfinitAI configuration is incomplete. Please check INFINITAI_API_KEY, INFINITAI_BASE_URL, and INFINITAI_MODEL in the backend .env file.';
        } else {
            userMessage = msg.length > 200 ? msg.substring(0, 200) + '...' : msg;
        }

        res.status(statusCode).json({
            success: false,
            error: userMessage,
            errorCategory,
            elapsed: `${elapsed}ms`
        });
    }
});

module.exports = router;
