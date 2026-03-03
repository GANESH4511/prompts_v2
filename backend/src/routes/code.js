const express = require('express');
const fs = require('fs');
const path = require('path');
const { prisma } = require('../lib/prisma');
const { resolveProjectRoot } = require('../lib/resolveProject');

const router = express.Router();

// GET /api/code/:id - Read source code for a page
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const page = await prisma.page.findUnique({
            where: { id },
            select: { filePath: true, componentName: true, projectId: true }
        });

        if (!page) {
            return res.status(404).json({ success: false, error: 'Page not found' });
        }

        // Resolve the project root from DB using the page's project
        const resolved = await resolveProjectRoot({ projectId: page.projectId, pageId: id });
        const rootDir = resolved.rootDir;

        if (!rootDir) {
            return res.status(400).json({
                success: false,
                error: 'No project found for this page. Please ensure it belongs to a registered project.'
            });
        }

        // filePath is stored as relative path like "app/form-completion/{id}/page.js"
        const absolutePath = path.join(rootDir, page.filePath.split('/').join(path.sep));

        if (!fs.existsSync(absolutePath)) {
            return res.status(404).json({
                success: false,
                error: `Source file not found: ${page.filePath}`,
                filePath: page.filePath,
                resolvedPath: absolutePath
            });
        }

        const sourceCode = fs.readFileSync(absolutePath, 'utf-8');
        const stats = fs.statSync(absolutePath);

        res.json({
            success: true,
            sourceCode,
            filePath: page.filePath,
            absolutePath,
            componentName: page.componentName,
            fileSize: stats.size,
            lastModified: stats.mtime
        });

    } catch (error) {
        console.error('Error reading source code:', error);
        res.status(500).json({ success: false, error: 'Failed to read source code' });
    }
});

// POST /api/code/:id - Save source code for a page
router.post('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { sourceCode } = req.body;

        if (sourceCode === undefined) {
            return res.status(400).json({ success: false, error: 'Missing sourceCode in body' });
        }

        const page = await prisma.page.findUnique({
            where: { id },
            select: { filePath: true, projectId: true }
        });

        if (!page) {
            return res.status(404).json({ success: false, error: 'Page not found' });
        }

        // Resolve the project root from DB using the page's project
        const resolved = await resolveProjectRoot({ projectId: page.projectId, pageId: id });
        const rootDir = resolved.rootDir;

        if (!rootDir) {
            return res.status(400).json({
                success: false,
                error: 'No project found for this page. Please ensure it belongs to a registered project.'
            });
        }

        const absolutePath = path.join(rootDir, page.filePath.split('/').join(path.sep));

        if (!fs.existsSync(absolutePath)) {
            return res.status(404).json({
                success: false,
                error: `Source file not found: ${page.filePath}`
            });
        }

        // Write the updated source code back to the file
        fs.writeFileSync(absolutePath, sourceCode, 'utf-8');

        // Update totalLines in database
        const totalLines = sourceCode.split(/\r\n|\r|\n/).length;
        await prisma.page.update({
            where: { id },
            data: { totalLines }
        });

        res.json({
            success: true,
            message: 'Source code saved successfully',
            totalLines
        });

    } catch (error) {
        console.error('Error saving source code:', error);
        res.status(500).json({ success: false, error: 'Failed to save source code' });
    }
});

module.exports = router;
