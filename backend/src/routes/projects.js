const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');
const { seedProject } = require('./seed');

const prisma = new PrismaClient();

// Get all projects for a user
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const projects = await prisma.project.findMany({
            where: { userId },
            orderBy: { updatedAt: 'desc' }
        });

        res.json({
            success: true,
            projects
        });
    } catch (error) {
        console.error('Error fetching projects:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch projects'
        });
    }
});

// Create a new project
router.post('/', async (req, res) => {
    try {
        const { userId, name, path: projectPath, description } = req.body;

        if (!userId || !name || !projectPath) {
            return res.status(400).json({
                success: false,
                message: 'userId, name, and path are required'
            });
        }

        // Normalize the path
        const normalizedPath = path.normalize(projectPath).replace(/\\/g, '/');

        // Check if path exists
        if (!fs.existsSync(projectPath)) {
            return res.status(400).json({
                success: false,
                message: 'The specified path does not exist'
            });
        }

        // Check if project with same path already exists for this user
        const existingProject = await prisma.project.findFirst({
            where: {
                userId,
                path: normalizedPath
            }
        });

        if (existingProject) {
            return res.status(400).json({
                success: false,
                message: 'A project with this path already exists'
            });
        }

        // Deactivate all other projects for this user
        await prisma.project.updateMany({
            where: { userId },
            data: { isActive: false }
        });

        // Create new project and set it as active
        const project = await prisma.project.create({
            data: {
                userId,
                name,
                path: normalizedPath,
                description: description || '',
                isActive: true
            }
        });

        // Auto-sync: scan, classify, and store all project files
        let syncSummary = null;
        try {
            console.log(`\n🚀 Auto-syncing new project: ${name}`);
            const syncResult = await seedProject(projectPath, project.id);
            syncSummary = syncResult.summary;
            console.log(`✅ Auto-sync complete for project: ${name}`);
        } catch (syncError) {
            console.error(`⚠️ Auto-sync failed for project ${name}:`, syncError.message);
            // Don't fail the project creation, just warn
        }

        res.json({
            success: true,
            project,
            syncSummary
        });
    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create project'
        });
    }
});

// Set active project
router.put('/:projectId/activate', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'userId is required'
            });
        }

        // Get the project to verify ownership
        const project = await prisma.project.findUnique({
            where: { id: projectId }
        });

        if (!project) {
            return res.status(404).json({
                success: false,
                message: 'Project not found'
            });
        }

        if (project.userId !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        // Deactivate all projects for this user
        await prisma.project.updateMany({
            where: { userId },
            data: { isActive: false }
        });

        // Activate the selected project
        const updatedProject = await prisma.project.update({
            where: { id: projectId },
            data: { isActive: true }
        });

        res.json({
            success: true,
            project: updatedProject
        });
    } catch (error) {
        console.error('Error activating project:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to activate project'
        });
    }
});

// Get active project for a user
router.get('/user/:userId/active', async (req, res) => {
    try {
        const { userId } = req.params;

        const project = await prisma.project.findFirst({
            where: {
                userId,
                isActive: true
            }
        });

        res.json({
            success: true,
            project
        });
    } catch (error) {
        console.error('Error fetching active project:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch active project'
        });
    }
});

// Update project
router.put('/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { name, description } = req.body;

        const project = await prisma.project.update({
            where: { id: projectId },
            data: {
                ...(name && { name }),
                ...(description !== undefined && { description })
            }
        });

        res.json({
            success: true,
            project
        });
    } catch (error) {
        console.error('Error updating project:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update project'
        });
    }
});

// Delete project
router.delete('/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;

        await prisma.project.delete({
            where: { id: projectId }
        });

        res.json({
            success: true,
            message: 'Project deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete project'
        });
    }
});

// Open native Windows folder picker dialog (modern Explorer style)
router.post('/pick-folder', async (req, res) => {
    try {
        const { exec } = require('child_process');
        const scriptPath = path.join(__dirname, '..', 'scripts', 'folder-picker.ps1');

        exec(
            `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
            { timeout: 120000 },
            (error, stdout, stderr) => {
                if (error) {
                    console.error('Folder picker error:', error);
                    return res.status(500).json({
                        success: false,
                        message: 'Failed to open folder picker'
                    });
                }

                const selectedPath = stdout.trim();

                if (selectedPath === '::CANCELLED::' || !selectedPath || selectedPath.startsWith('::ERROR::')) {
                    return res.json({
                        success: true,
                        cancelled: true,
                        path: null
                    });
                }

                res.json({
                    success: true,
                    cancelled: false,
                    path: selectedPath.replace(/\\/g, '/')
                });
            }
        );
    } catch (error) {
        console.error('Error opening folder picker:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to open folder picker'
        });
    }
});

// Browse directory (for folder selection)
router.get('/browse', async (req, res) => {
    try {
        const { path: dirPath } = req.query;
        const targetPath = dirPath || 'C:/';

        if (!fs.existsSync(targetPath)) {
            return res.status(400).json({
                success: false,
                message: 'Path does not exist'
            });
        }

        const stats = fs.statSync(targetPath);
        if (!stats.isDirectory()) {
            return res.status(400).json({
                success: false,
                message: 'Path is not a directory'
            });
        }

        const items = fs.readdirSync(targetPath, { withFileTypes: true });
        const directories = items
            .filter(item => item.isDirectory() && !item.name.startsWith('.'))
            .map(item => ({
                name: item.name,
                path: path.join(targetPath, item.name).replace(/\\/g, '/')
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        res.json({
            success: true,
            currentPath: targetPath.replace(/\\/g, '/'),
            parentPath: path.dirname(targetPath).replace(/\\/g, '/'),
            directories
        });
    } catch (error) {
        console.error('Error browsing directory:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to browse directory'
        });
    }
});

module.exports = router;
