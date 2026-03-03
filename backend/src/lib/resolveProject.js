/**
 * Shared helper to resolve project root directory from the database.
 * 
 * IMPORTANT: The project root is ALWAYS dynamic — it comes from the
 * project record in the database. There is NO hardcoded fallback.
 * 
 * Usage:
 *   const { resolveProjectRoot } = require('../lib/resolveProject');
 *   const rootDir = await resolveProjectRoot({ projectId, filePath });
 */

const path = require('path');
const { prisma } = require('./prisma');

/**
 * Resolve the project root directory. Tries multiple strategies:
 * 
 * 1. If projectId is provided, look up the project's path in the DB
 * 2. If filePath is provided (and projectId is not), look up the page
 *    in the DB to find its project, then use that project's path
 * 3. If pageId is provided, look up the page to get its projectId,
 *    then resolve the project's path
 * 
 * @param {Object} options
 * @param {string} [options.projectId] - Direct project ID
 * @param {string} [options.filePath]  - Relative file path (e.g. "backend/src/routes/chat.js")
 * @param {string} [options.pageId]    - Page ID from the database
 * @returns {Promise<{ rootDir: string|null, projectId: string|null }>}
 */
async function resolveProjectRoot({ projectId, filePath, pageId } = {}) {
    // Strategy 1: Direct projectId lookup
    if (projectId) {
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (project && project.path) {
            return {
                rootDir: project.path.replace(/\//g, path.sep),
                projectId
            };
        }
    }

    // Strategy 2: Look up by pageId
    if (pageId) {
        const page = await prisma.page.findUnique({
            where: { id: pageId },
            select: { projectId: true }
        });
        if (page && page.projectId) {
            const project = await prisma.project.findUnique({ where: { id: page.projectId } });
            if (project && project.path) {
                return {
                    rootDir: project.path.replace(/\//g, path.sep),
                    projectId: page.projectId
                };
            }
        }
    }

    // Strategy 3: Look up by filePath
    if (filePath) {
        const pageRecord = await prisma.page.findFirst({
            where: { filePath },
            select: { projectId: true }
        });
        if (pageRecord && pageRecord.projectId) {
            const project = await prisma.project.findUnique({ where: { id: pageRecord.projectId } });
            if (project && project.path) {
                return {
                    rootDir: project.path.replace(/\//g, path.sep),
                    projectId: pageRecord.projectId
                };
            }
        }
    }

    // No project found — return null (caller must handle)
    return { rootDir: null, projectId: null };
}

module.exports = { resolveProjectRoot };
