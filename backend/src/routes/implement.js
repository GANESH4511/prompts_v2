/**
 * POST /api/implement         — Generate diff preview (2-pass adaptive pipeline)
 * POST /api/implement/apply   — Apply confirmed changes to files
 * POST /api/implement/undo    — Rollback changes from backup
 *
 * Pipeline (always 2 passes):
 *   Pass 1: implement-plan/v2 — NLP context + source + request → JSON plan + affected sections
 *   Pass 2: implement-section/v2 — DEVELOPER context + source + plan → SEARCH/REPLACE patches (all files)
 */

const express = require('express');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generatePrompt, generatePromptStream, loadTemplate, getLatestVersion } = require('../llm');
const { prisma } = require('../lib/prisma');
const { resolveProjectRoot } = require('../lib/resolveProject');
const { seedProject } = require('./seed');
const { fileExists, buildDiff, parseSearchReplaceBlocks, applySearchReplacePatches } = require('../lib/fileOps');
const { buildPageContext } = require('../lib/contextBuilder');

const router = express.Router();
const pendingSessions = new Map();

// ── JSON response parser (shared) ──
const { parseWithRepair } = require('../lib/jsonRepair');
function parseLLMResponse(raw) { return parseWithRepair(raw); }

// ── Debug logging — writes LLM I/O to backend/logs/ ──
const LOGS_DIR = path.resolve(__dirname, '../../logs');
function debugLog(label, data) {
    try {
        if (!fsSync.existsSync(LOGS_DIR)) fsSync.mkdirSync(LOGS_DIR, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const file = path.join(LOGS_DIR, `implement-${label}-${ts}.txt`);
        const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        fsSync.writeFileSync(file, content, 'utf-8');
        console.log(`  📝 Debug: logs/implement-${label}-${ts}.txt (${content.length} chars)`);
    } catch (e) {
        console.warn(`  ⚠️ Debug log failed: ${e.message}`);
    }
}


// ==========================================
// POST /api/implement — Generate diff preview
// ==========================================
router.post('/', async (req, res) => {
    const startTime = Date.now();

    try {
        const { pageId, promptContent, scope, additionalFiles } = req.body;

        if (!pageId) return res.status(400).json({ success: false, error: 'pageId is required' });
        if (!promptContent?.trim()) return res.status(400).json({ success: false, error: 'promptContent is required' });

        console.log(`\n🚀 Implement Request`);
        console.log(`  📋 Page: ${pageId}`);
        console.log(`  📏 Prompt: ${promptContent.length} chars`);
        console.log(`  🎯 Scope: ${scope || 'single'}`);

        // ── Load page with sections + prompts ──
        const page = await prisma.page.findUnique({
            where: { id: pageId },
            include: {
                sections: { include: { prompts: true }, orderBy: { startLine: 'asc' } }
            }
        });
        if (!page) return res.status(404).json({ success: false, error: 'Page not found' });

        // ── Resolve project root + read source ──
        const resolved = await resolveProjectRoot({ projectId: page.projectId, pageId });
        const rootDir = resolved.rootDir;
        if (!rootDir) return res.status(400).json({ success: false, error: 'No project found for this page.' });

        const absolutePath = path.join(rootDir, page.filePath.split('/').join(path.sep));
        if (!await fileExists(absolutePath)) return res.status(404).json({ success: false, error: `Source file not found: ${page.filePath}` });

        const sourceCode = await fs.readFile(absolutePath, 'utf-8');
        const lineCount = sourceCode.split('\n').length;
        console.log(`  📄 Source: ${page.filePath} (${lineCount} lines)`);

        // ── Build file structure context (multi-scope) ──
        let fileStructureContext = '';
        if (scope === 'multi' || additionalFiles) {
            try {
                const allPages = await prisma.page.findMany({
                    where: page.projectId ? { projectId: page.projectId } : {},
                    select: { filePath: true, componentName: true, purpose: true }
                });
                fileStructureContext = '\n\nProject file structure:\n' +
                    allPages.map(p => `- ${p.filePath} (${p.componentName}): ${p.purpose}`).join('\n');
            } catch (e) { console.warn('  ⚠️ File structure load failed:', e.message); }
        }

        // ── Build context blocks ──
        const nlpContext = buildPageContext(page, 'nlp');
        const devContext = buildPageContext(page, 'developer');

        // ==================================================================
        // PASS 1: PLANNING — identify affected sections + change plan
        // ==================================================================
        const planVersion = getLatestVersion('implement-plan');
        const planTemplate = loadTemplate('implement-plan', planVersion);
        console.log(`  📋 Plan template: implement-plan/${planVersion}`);

        const pass1Prompt =
            (nlpContext ? `${nlpContext}\n\n` : '') +
            `Current source code file: ${page.filePath}\n\n` +
            `--- SOURCE CODE ---\n${sourceCode}\n--- END SOURCE CODE ---\n\n` +
            `--- CHANGE REQUEST ---\n${promptContent}\n--- END CHANGE REQUEST ---` +
            fileStructureContext;

        debugLog('pass1-input', `=== SYSTEM ===\n${planTemplate.content}\n\n=== USER ===\n${pass1Prompt}`);

        console.log(`  🧠 Pass 1: Planning...`);
        const planRaw = await generatePrompt({
            template: planTemplate.content,
            sourceCode: pass1Prompt,
            metadata: { templateType: 'implement-plan', templateVersion: planVersion, filePath: page.filePath }
        });

        debugLog('pass1-output', planRaw);

        const planResponse = parseLLMResponse(planRaw);
        const affectedSections = planResponse.affectedSections || [];
        const memory = planResponse.memory || '';
        console.log(`  📦 Plan: ${planResponse.plan?.length || 0} changes, affected: [${affectedSections.join(', ')}]`);

        // ==================================================================
        // PASS 2: CODE GENERATION — SEARCH/REPLACE patches
        // ==================================================================
        const diffs = [];
        const planSummary = JSON.stringify(planResponse.plan || [], null, 2);

        const secVersion = getLatestVersion('implement-section');
        const secTemplate = loadTemplate('implement-section', secVersion);
        console.log(`  📋 Implement template: implement-section/${secVersion} (SEARCH/REPLACE mode)`);

        const filteredDevContext = affectedSections.length > 0
            ? buildPageContext(page, 'developer', affectedSections)
            : devContext;

        const pass2Prompt =
            (filteredDevContext ? `${filteredDevContext}\n\n` : '') +
            `Current source code file: ${page.filePath}\n\n` +
            `--- SOURCE CODE ---\n${sourceCode}\n--- END SOURCE CODE ---\n\n` +
            `--- CHANGE PLAN ---\n${planSummary}\n--- END CHANGE PLAN ---\n\n` +
            `--- CHANGE REQUEST ---\n${promptContent}\n--- END CHANGE REQUEST ---` +
            fileStructureContext;

        debugLog('pass2-input', `=== SYSTEM ===\n${secTemplate.content}\n\n=== USER ===\n${pass2Prompt}`);

        console.log(`  🤖 Pass 2: Generating SEARCH/REPLACE patches...`);
        const llmRaw = await generatePrompt({
            template: secTemplate.content,
            sourceCode: pass2Prompt,
            metadata: { templateType: 'implement-section', templateVersion: secVersion, filePath: page.filePath }
        });

        debugLog('pass2-output', llmRaw);

        const { patches, newFiles } = parseSearchReplaceBlocks(llmRaw);
        console.log(`  📦 Parsed ${patches.length} SEARCH/REPLACE patch(es)`);

        if (patches.length > 0) {
            const patchedContent = applySearchReplacePatches(sourceCode, patches);
            if (patchedContent.trim() !== sourceCode.trim()) {
                diffs.push({
                    filePath: page.filePath,
                    absolutePath: absolutePath,
                    action: 'modify',
                    description: memory || 'Modified code based on change request',
                    oldCode: sourceCode,
                    newCode: patchedContent,
                    diff: buildDiff(sourceCode, patchedContent),
                    isNew: false
                });
            }
        }

        for (const nf of newFiles) {
            const nfPath = path.isAbsolute(nf.filePath) ? nf.filePath : path.join(rootDir, nf.filePath.split('/').join(path.sep));
            diffs.push({ filePath: nf.filePath, absolutePath: nfPath, action: 'create', description: 'New file', oldCode: '', newCode: nf.content, diff: buildDiff('', nf.content), isNew: true });
        }

        // ── Create session ──
        const sessionId = crypto.randomUUID();
        pendingSessions.set(sessionId, {
            pageId, projectId: page.projectId, promptContent,
            scope: scope || 'single', diffs, rootDir, createdAt: Date.now()
        });

        // Clean up old sessions
        const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
        for (const [sid, s] of pendingSessions.entries()) { if (s.createdAt < thirtyMinAgo) pendingSessions.delete(sid); }

        const elapsed = Date.now() - startTime;
        console.log(`  ✅ Preview: ${elapsed}ms (${diffs.length} file(s) affected)\n`);

        res.json({
            success: true,
            sessionId,
            memory,
            diffs: diffs.map(d => ({ filePath: d.filePath, action: d.action, description: d.description, oldCode: d.oldCode, newCode: d.newCode, diff: d.diff, isNew: d.isNew })),
            suggestedFiles: planResponse.suggestedFiles || [],
            elapsed: `${elapsed}ms`
        });

    } catch (error) {
        const elapsed = Date.now() - startTime;
        console.error(`  ❌ Implement failed (${elapsed}ms):`, error.message);
        const msg = error.message || '';
        let status = 500;
        if (msg.includes('rate limit') || msg.includes('429')) status = 429;
        else if (msg.includes('authentication') || msg.includes('API key')) status = 401;
        res.status(status).json({ success: false, error: msg.length > 300 ? msg.substring(0, 300) + '...' : msg, elapsed: `${elapsed}ms` });
    }
});


// ==========================================
// POST /api/implement/apply — Apply confirmed changes
// ==========================================
router.post('/apply', async (req, res) => {
    const startTime = Date.now();
    try {
        const { sessionId, selectedDiffs } = req.body;
        if (!sessionId) return res.status(400).json({ success: false, error: 'sessionId is required' });

        const session = pendingSessions.get(sessionId);
        if (!session) return res.status(404).json({ success: false, error: 'Session expired or not found.' });

        console.log(`\n✅ Implement Apply`);
        console.log(`  📋 Session: ${sessionId}`);

        const diffsToApply = selectedDiffs || session.diffs;
        const filesChanged = [];

        for (const diff of diffsToApply) {
            const absPath = diff.absolutePath || path.join(session.rootDir, diff.filePath.split('/').join(path.sep));

            if (diff.isNew || diff.action === 'create') {
                await fs.mkdir(path.dirname(absPath), { recursive: true });
                await fs.writeFile(absPath, diff.newCode, 'utf-8');
                console.log(`  🆕 Created: ${diff.filePath}`);
                filesChanged.push({ filePath: diff.filePath, absolutePath: absPath, backupPath: null, action: 'create' });
            } else {
                const backupPath = absPath + '.bak';
                if (await fileExists(absPath)) { await fs.copyFile(absPath, backupPath); console.log(`  📦 Backup: ${backupPath}`); }
                await fs.writeFile(absPath, diff.newCode, 'utf-8');
                console.log(`  ✏️ Modified: ${diff.filePath}`);
                filesChanged.push({ filePath: diff.filePath, absolutePath: absPath, backupPath, action: 'modify' });
            }
        }

        const history = await prisma.implementHistory.create({
            data: { pageId: session.pageId, projectId: session.projectId, promptContent: session.promptContent, scope: session.scope, filesChanged: JSON.stringify(filesChanged), status: 'applied' }
        });

        const seedResult = await seedProject(session.rootDir, session.projectId);
        pendingSessions.delete(sessionId);

        const elapsed = Date.now() - startTime;
        console.log(`  ⏱️ Applied in ${elapsed}ms\n`);
        res.json({ success: true, historyId: history.id, filesChanged: filesChanged.length, elapsed: `${elapsed}ms`, seedResult: seedResult.success ? 'synced' : 'seed_warning' });

    } catch (error) {
        const elapsed = Date.now() - startTime;
        console.error(`  ❌ Apply failed (${elapsed}ms):`, error.message);
        res.status(500).json({ success: false, error: error.message || 'Failed to apply changes', elapsed: `${elapsed}ms` });
    }
});


// ==========================================
// POST /api/implement/undo — Rollback changes
// ==========================================
router.post('/undo', async (req, res) => {
    const startTime = Date.now();
    try {
        const { historyId } = req.body;
        if (!historyId) return res.status(400).json({ success: false, error: 'historyId is required' });

        console.log(`\n↩️ Implement Undo`);
        console.log(`  📋 History: ${historyId}`);

        const history = await prisma.implementHistory.findUnique({ where: { id: historyId } });
        if (!history) return res.status(404).json({ success: false, error: 'History record not found' });
        if (history.status === 'reverted') return res.status(400).json({ success: false, error: 'Already reverted' });

        const filesChanged = JSON.parse(history.filesChanged);
        let restoredCount = 0;

        for (const file of filesChanged) {
            if (file.action === 'create') {
                try { await fs.unlink(file.absolutePath); restoredCount++; console.log(`  🗑️ Deleted: ${file.filePath}`); } catch { }
            } else if (file.action === 'modify' && file.backupPath) {
                if (await fileExists(file.backupPath)) {
                    await fs.copyFile(file.backupPath, file.absolutePath);
                    await fs.unlink(file.backupPath);
                    restoredCount++;
                    console.log(`  ↩️ Restored: ${file.filePath}`);
                }
            }
        }

        await prisma.implementHistory.update({ where: { id: historyId }, data: { status: 'reverted' } });

        const resolved = await resolveProjectRoot({ projectId: history.projectId });
        const seedResult = resolved.rootDir ? await seedProject(resolved.rootDir, history.projectId) : { success: false };

        const elapsed = Date.now() - startTime;
        console.log(`  ⏱️ Undone in ${elapsed}ms (${restoredCount} files)\n`);
        res.json({ success: true, restoredFiles: restoredCount, elapsed: `${elapsed}ms`, seedResult: seedResult.success ? 'synced' : 'seed_warning' });

    } catch (error) {
        const elapsed = Date.now() - startTime;
        console.error(`  ❌ Undo failed (${elapsed}ms):`, error.message);
        res.status(500).json({ success: false, error: error.message, elapsed: `${elapsed}ms` });
    }
});


// ==========================================
// POST /api/implement/stream — SSE streaming (main route used by frontend)
// ==========================================
const MAX_RETRY_ATTEMPTS = 2;

router.post('/stream', async (req, res) => {
    const startTime = Date.now();

    try {
        const { pageId, promptContent, scope, additionalFiles } = req.body;

        if (!pageId || !promptContent?.trim()) {
            return res.status(400).json({ success: false, error: 'pageId and promptContent are required' });
        }

        console.log(`\n🚀 Implement Stream`);
        console.log(`  📋 Page: ${pageId}`);

        // ── SSE headers ──
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        const sendEvent = (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        const done = () => { res.write('data: [DONE]\n\n'); res.end(); };

        // ── Load page ──
        const page = await prisma.page.findUnique({
            where: { id: pageId },
            include: { sections: { include: { prompts: true }, orderBy: { startLine: 'asc' } } }
        });
        if (!page) { sendEvent('error', { error: 'Page not found' }); return done(); }

        const resolved = await resolveProjectRoot({ projectId: page.projectId, pageId });
        const rootDir = resolved.rootDir;
        if (!rootDir) { sendEvent('error', { error: 'No project found for this page.' }); return done(); }

        const absolutePath = path.join(rootDir, page.filePath.split('/').join(path.sep));
        if (!await fileExists(absolutePath)) { sendEvent('error', { error: `Source file not found: ${page.filePath}` }); return done(); }

        const sourceCode = await fs.readFile(absolutePath, 'utf-8');
        const lineCount = sourceCode.split('\n').length;
        console.log(`  📄 ${page.filePath} (${lineCount} lines)`);

        let fileStructureContext = '';
        if (scope === 'multi' || additionalFiles) {
            try {
                const allPages = await prisma.page.findMany({
                    where: page.projectId ? { projectId: page.projectId } : {},
                    select: { filePath: true, componentName: true, purpose: true }
                });
                fileStructureContext = '\n\nProject file structure:\n' +
                    allPages.map(p => `- ${p.filePath} (${p.componentName}): ${p.purpose}`).join('\n');
            } catch (e) { console.warn('  ⚠️ File structure load failed:', e.message); }
        }

        const nlpContext = buildPageContext(page, 'nlp');
        const devContext = buildPageContext(page, 'developer');

        // ── Auto-retry loop ──
        let finalDiffs = [];
        let finalMemory = '';
        let finalSuggestedFiles = [];
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
            try {
                if (attempt > 1) {
                    sendEvent('retry', { attempt, maxAttempts: MAX_RETRY_ATTEMPTS, message: `Retrying... (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})` });
                }

                // ── Pass 1: Plan ──
                sendEvent('status', { message: attempt === 1 ? 'Analysing code...' : `Re-analysing (attempt ${attempt})...` });

                const planVersion = getLatestVersion('implement-plan');
                const planTemplate = loadTemplate('implement-plan', planVersion);
                const pass1Prompt =
                    (nlpContext ? `${nlpContext}\n\n` : '') +
                    `Current source code file: ${page.filePath}\n\n` +
                    `--- SOURCE CODE ---\n${sourceCode}\n--- END SOURCE CODE ---\n\n` +
                    `--- CHANGE REQUEST ---\n${promptContent}\n--- END CHANGE REQUEST ---` +
                    fileStructureContext;

                debugLog(`stream-pass1-input-attempt${attempt}`, `=== SYSTEM ===\n${planTemplate.content}\n\n=== USER ===\n${pass1Prompt}`);

                const planRaw = await generatePrompt({
                    template: planTemplate.content,
                    sourceCode: pass1Prompt,
                    metadata: { templateType: 'implement-plan', templateVersion: planVersion, filePath: page.filePath }
                });

                debugLog(`stream-pass1-output-attempt${attempt}`, planRaw);

                const planResponse = parseLLMResponse(planRaw);
                const affectedSections = planResponse.affectedSections || [];
                const memory = planResponse.memory || '';
                const planSummary = JSON.stringify(planResponse.plan || [], null, 2);

                sendEvent('plan', { memory, plan: planResponse.plan || [], suggestedFiles: planResponse.suggestedFiles || [] });

                // ── Pass 2: Code gen ──
                sendEvent('status', { message: attempt === 1 ? 'Generating code changes...' : `Generating code (attempt ${attempt})...` });

                const filteredDevContext = affectedSections.length > 0
                    ? buildPageContext(page, 'developer', affectedSections)
                    : devContext;

                const diffs = [];

                const secVersion = getLatestVersion('implement-section');
                const secTemplate = loadTemplate('implement-section', secVersion);
                const pass2Prompt =
                    (filteredDevContext ? `${filteredDevContext}\n\n` : '') +
                    `Current source code file: ${page.filePath}\n\n` +
                    `--- SOURCE CODE ---\n${sourceCode}\n--- END SOURCE CODE ---\n\n` +
                    `--- CHANGE PLAN ---\n${planSummary}\n--- END CHANGE PLAN ---\n\n` +
                    `--- CHANGE REQUEST ---\n${promptContent}\n--- END CHANGE REQUEST ---` +
                    fileStructureContext;

                debugLog(`stream-pass2-input-attempt${attempt}`, `=== SYSTEM ===\n${secTemplate.content}\n\n=== USER ===\n${pass2Prompt}`);

                const llmRaw = await generatePromptStream({
                    template: secTemplate.content,
                    sourceCode: pass2Prompt,
                    metadata: { templateType: 'implement-section', templateVersion: secVersion, filePath: page.filePath },
                    onChunk: (chunk) => sendEvent('chunk', { content: chunk })
                });

                debugLog(`stream-pass2-output-attempt${attempt}`, llmRaw);

                const { patches, newFiles } = parseSearchReplaceBlocks(llmRaw);
                console.log(`  📦 Parsed ${patches.length} SEARCH/REPLACE patch(es)`);

                if (patches.length > 0) {
                    const patchedContent = applySearchReplacePatches(sourceCode, patches);
                    if (patchedContent.trim() !== sourceCode.trim()) {
                        diffs.push({ filePath: page.filePath, absolutePath, action: 'modify', description: memory || 'Modified code', oldCode: sourceCode, newCode: patchedContent, diff: buildDiff(sourceCode, patchedContent), isNew: false });
                    }
                }
                for (const nf of newFiles) {
                    const nfPath = path.isAbsolute(nf.filePath) ? nf.filePath : path.join(rootDir, nf.filePath.split('/').join(path.sep));
                    diffs.push({ filePath: nf.filePath, absolutePath: nfPath, action: 'create', description: 'New file', oldCode: '', newCode: nf.content, diff: buildDiff('', nf.content), isNew: true });
                }

                if (diffs.length === 0) {
                    lastError = 'No code changes were generated. Try rephrasing your request.';
                    console.warn(`  ⚠️ Attempt ${attempt}: no diffs produced`);
                    if (attempt < MAX_RETRY_ATTEMPTS) continue;
                } else {
                    finalDiffs = diffs;
                    finalMemory = memory;
                    finalSuggestedFiles = planResponse.suggestedFiles || [];
                    if (attempt > 1) console.log(`  ✅ Succeeded on attempt ${attempt}`);
                    break;
                }

            } catch (attemptErr) {
                lastError = (attemptErr && attemptErr.message) ? attemptErr.message : String(attemptErr || 'Unknown error');
                console.warn(`  ⚠️ Attempt ${attempt} error: ${lastError}`);
                if (attempt < MAX_RETRY_ATTEMPTS) continue;
            }
        }

        if (finalDiffs.length === 0) {
            sendEvent('error', { error: lastError || 'Implementation failed. Try rephrasing your request.', retryable: true });
            return done();
        }

        // ── Create session ──
        const sessionId = crypto.randomUUID();
        pendingSessions.set(sessionId, {
            pageId, projectId: page.projectId, promptContent,
            scope: scope || 'single', diffs: finalDiffs, rootDir, createdAt: Date.now()
        });
        const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
        for (const [sid, s] of pendingSessions.entries()) { if (s.createdAt < thirtyMinAgo) pendingSessions.delete(sid); }

        const elapsed = Date.now() - startTime;
        sendEvent('result', {
            sessionId, memory: finalMemory,
            diffs: finalDiffs.map(d => ({ filePath: d.filePath, action: d.action, description: d.description, oldCode: d.oldCode, newCode: d.newCode, diff: d.diff, isNew: d.isNew })),
            suggestedFiles: finalSuggestedFiles,
            elapsed: `${elapsed}ms`
        });
        console.log(`  ✅ Stream complete: ${elapsed}ms (${finalDiffs.length} file(s))\n`);
        done();

    } catch (error) {
        const msg = (error && error.message) ? error.message : String(error || 'Unknown error');
        console.error(`  ❌ Stream failed:`, msg);
        try { res.write(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`); res.write('data: [DONE]\n\n'); res.end(); } catch { }
    }
});


// ==========================================
// GET /api/implement/changes/:pageId — Change history
// ==========================================
router.get('/changes/:pageId', async (req, res) => {
    try {
        const { pageId } = req.params;
        const { limit = 50 } = req.query;
        const changes = await prisma.changeRequest.findMany({
            where: { pageId },
            orderBy: { createdAt: 'desc' },
            take: Math.min(parseInt(limit) || 50, 100)
        });
        res.json({
            success: true,
            changes: changes.map(c => ({ id: c.id, changeText: c.changeText, changeType: c.changeType, status: c.status, createdAt: c.createdAt, hasPlan: !!c.planJson }))
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


// ==========================================
// DELETE /api/implement/changes/:id — Delete a change request
// ==========================================
router.delete('/changes/:id', async (req, res) => {
    try {
        await prisma.changeRequest.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (error) {
        if (error.code === 'P2025') return res.status(404).json({ success: false, error: 'Not found' });
        res.status(500).json({ success: false, error: error.message });
    }
});


module.exports = router;
