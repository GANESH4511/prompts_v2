const express = require('express');
const { prisma } = require('../lib/prisma');

const router = express.Router();

// GET all pages with their data
// Supports optional projectId query parameter for project-scoped filtering
router.get('/', async (req, res) => {
    try {
        const { projectId } = req.query;

        const where = projectId ? { projectId } : {};

        const pages = await prisma.page.findMany({
            where,
            include: {
                sections: {
                    include: {
                        prompts: true
                    }
                }
            }
        });

        res.json({ pages });
    } catch (error) {
        console.error('Error fetching pages:', error);
        res.status(500).json({ error: 'Failed to fetch pages' });
    }
});

module.exports = router;
