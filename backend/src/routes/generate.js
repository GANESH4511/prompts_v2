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
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generatePrompt, loadTemplate, getLatestVersion } = require('../llm');
const { prisma } = require('../lib/prisma');

const router = express.Router();

// Helper to find project root (same logic as seed.js)
const findProjectRoot = () => {
    let candidates = [];
    if (process.env.PROJECT_ROOT) {
        candidates.push(process.env.PROJECT_ROOT);
    }
    candidates.push('C:\\SNIX\\sify\\HrAssist\\exam');

    const relativeRoot = path.resolve(__dirname, '../../../../../');
    candidates.push(relativeRoot);

    for (const root of candidates) {
        const checkAppDir = path.join(root, 'app');
        if (fs.existsSync(checkAppDir)) {
            return root;
        }
    }

    return process.env.PROJECT_ROOT || 'C:\\SNIX\\sify\\HrAssist\\exam';
};

const PROJECT_ROOT = findProjectRoot();

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
 * Trigger the existing /api/seed pipeline internally.
 * Makes an HTTP call to the seed endpoint.
 */
async function triggerSeed(projectId) {
    const port = process.env.PORT || 5000;
    const seedUrl = `http://localhost:${port}/api/seed`;

    console.log(`  🔄 Triggering seed for project: ${projectId || 'default'}...`);

    const response = await fetch(seedUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId })
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Seed failed (${response.status}): ${body}`);
    }

    const result = await response.json();

    if (!result.success) {
        throw new Error(`Seed returned failure: ${JSON.stringify(result)}`);
    }

    console.log('  ✅ Seed completed successfully');
    return result;
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

        // --- Step 1: Resolve and read source code ---
        let absoluteSourcePath;

        // If filePath is already absolute
        if (path.isAbsolute(filePath)) {
            absoluteSourcePath = filePath;
        } else {
            // Relative to project root
            absoluteSourcePath = path.join(PROJECT_ROOT, filePath.split('/').join(path.sep));
        }

        if (!fs.existsSync(absoluteSourcePath)) {
            return res.status(404).json({
                success: false,
                error: `Source file not found: ${filePath}`,
                resolvedPath: absoluteSourcePath
            });
        }

        const sourceCode = fs.readFileSync(absoluteSourcePath, 'utf-8');
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

        // --- Step 4: Generate NLP prompt ---
        console.log(`  🤖 Generating NLP prompt...`);
        const nlpOutput = await generatePrompt({
            template: nlpTemplate.content,
            sourceCode,
            metadata: {
                templateType: 'nlp',
                templateVersion: nlpVersion,
                filePath
            }
        });

        // --- Step 5: Generate Developer prompt ---
        console.log(`  🤖 Generating Developer prompt...`);
        const devOutput = await generatePrompt({
            template: devTemplate.content,
            sourceCode,
            metadata: {
                templateType: 'developer',
                templateVersion: devVersion,
                filePath
            }
        });

        // --- Step 6: Combine into .txt using existing delimiters ---
        const fileName = path.basename(absoluteSourcePath);
        const promptContent = buildPromptFileContent({
            fileName,
            nlpOutput,
            devOutput,
            nlpVersion,
            devVersion
        });

        // --- Step 7: Delete old prompt file first ---
        const sourceDir = path.dirname(absoluteSourcePath);
        const baseName = path.basename(absoluteSourcePath, path.extname(absoluteSourcePath));
        const promptFilePath = path.join(sourceDir, `${baseName}.txt`);
        const tmpFilePath = promptFilePath + '.tmp';

        // Remove old prompt file if it exists
        if (fs.existsSync(promptFilePath)) {
            fs.unlinkSync(promptFilePath);
            console.log(`  🗑️  Deleted old prompt: ${promptFilePath}`);
        }
        // Also clean up any stale .tmp file
        if (fs.existsSync(tmpFilePath)) {
            fs.unlinkSync(tmpFilePath);
        }

        // --- Step 8: Write new prompt file ---
        // Write to temp file first, then rename (atomic)
        fs.writeFileSync(tmpFilePath, promptContent, 'utf-8');
        fs.renameSync(tmpFilePath, promptFilePath);

        const outputHash = crypto.createHash('sha256').update(promptContent).digest('hex').substring(0, 12);
        console.log(`  💾 Written: ${promptFilePath}`);
        console.log(`  📊 Output: ${promptContent.length} chars, hash=${outputHash}`);

        // --- Step 9: Trigger existing /api/seed to sync database ---
        const seedResult = await triggerSeed(projectId);

        // --- Step 10: Respond ---
        const elapsed = Date.now() - startTime;
        console.log(`  ⏱️  Total: ${elapsed}ms\n`);

        res.json({
            success: true,
            promptFilePath: path.relative(PROJECT_ROOT, promptFilePath).replace(/\\/g, '/'),
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
            seedResult: seedResult.summary || null
        });

    } catch (error) {
        const elapsed = Date.now() - startTime;
        console.error(`  ❌ Generate failed (${elapsed}ms):`, error.message);

        // Clean up temp file if it exists
        try {
            const { filePath } = req.body || {};
            if (filePath) {
                const sourceDir = path.dirname(
                    path.isAbsolute(filePath)
                        ? filePath
                        : path.join(PROJECT_ROOT, filePath.split('/').join(path.sep))
                );
                const baseName = path.basename(filePath, path.extname(filePath));
                const tmpPath = path.join(sourceDir, `${baseName}.txt.tmp`);
                if (fs.existsSync(tmpPath)) {
                    fs.unlinkSync(tmpPath);
                }
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
