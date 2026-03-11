const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { prisma } = require('../lib/prisma');
const { resolveProjectRoot } = require('../lib/resolveProject');

const router = express.Router();

/**
 * POST /api/save
 * 
 * Save edited prompt content to the source .txt file and update the database.
 * 
 * Flow:
 * 1. Find the page record in the database by pageId
 * 2. Determine the prompt file path (from DB or derive from filePath)
 * 3. Delete the old prompt file if it exists
 * 4. Write the new content to the prompt file
 * 5. Update rawContent in the database
 */
router.post('/', async (req, res) => {
    try {
        const { pageId, content, projectId } = req.body;

        if (!pageId || content === undefined) {
            return res.status(400).json({ success: false, error: 'Missing pageId or content' });
        }

        // Find the page with its file path info
        const page = await prisma.page.findUnique({
            where: { id: pageId },
            select: { promptFilePath: true, filePath: true, projectId: true }
        });

        if (!page) {
            return res.status(404).json({ success: false, error: 'Page not found' });
        }

        let targetFilePath = page.promptFilePath;

        // If no promptFilePath is linked, derive it from the source file path
        if (!targetFilePath && page.filePath) {
            // Determine project root from DB
            const resolved = await resolveProjectRoot({
                projectId: projectId || page.projectId,
                pageId,
                filePath: page.filePath
            });
            const rootDir = resolved.rootDir;

            if (!rootDir) {
                return res.status(400).json({
                    success: false,
                    error: 'No project found for this page. Please ensure it belongs to a registered project.'
                });
            }

            // Derive .txt path from the source code path
            const absoluteSourcePath = path.join(rootDir, page.filePath.split('/').join(path.sep));
            const sourceDir = path.dirname(absoluteSourcePath);
            const baseName = path.basename(absoluteSourcePath, path.extname(absoluteSourcePath));
            targetFilePath = path.join(sourceDir, `${baseName}.txt`);
        }

        if (!targetFilePath) {
            return res.status(400).json({ success: false, error: 'Cannot determine prompt file path for this page' });
        }

        console.log(`\n💾 Save Prompt`);
        console.log(`  📄 Page ID: ${pageId}`);
        console.log(`  📂 Target: ${targetFilePath}`);
        console.log(`  📊 Content: ${content.length} chars`);

        // Ensure the directory exists
        const dir = path.dirname(targetFilePath);
        await fs.mkdir(dir, { recursive: true });

        // Delete old file if it exists (clean slate)
        try {
            await fs.unlink(targetFilePath);
            console.log(`  🗑️  Deleted old file`);
        } catch {
            // File didn't exist, that's fine
        }

        // Write new content to the prompt file
        await fs.writeFile(targetFilePath, content, 'utf-8');
        console.log(`  ✅ Written new content to file`);

        // Update rawContent and promptFilePath in DB
        await prisma.page.update({
            where: { id: pageId },
            data: {
                rawContent: content,
                promptFilePath: targetFilePath
            }
        });
        console.log(`  ✅ Database updated`);

        res.json({ success: true, promptFilePath: targetFilePath });
    } catch (error) {
        console.error('Save error:', error);
        res.status(500).json({ success: false, error: 'Failed to save prompt: ' + error.message });
    }
});

module.exports = router;
