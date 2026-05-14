/**
 * RuFlo MCP API Routes
 * 
 * Exposes RuFlo's 200+ tools through the backend API.
 * 
 * Routes:
 *   GET  /api/ruflo/status      — MCP server status + readiness
 *   GET  /api/ruflo/tools       — List all available tools
 *   GET  /api/ruflo/categories  — Tools grouped by category
 *   POST /api/ruflo/execute     — Execute any tool by name
 */

const express = require('express');
const { getRufloClient } = require('../lib/rufloClient');
const { rufloLog } = require('../lib/rufloLogger');

const router = express.Router();

// ─── GET /api/ruflo/status ─────────────────────────────────
router.get('/status', async (req, res) => {
    try {
        const ruflo = getRufloClient();
        const available = await ruflo.isAvailable();

        res.json({
            success: true,
            available,
            url: ruflo.baseUrl,
            ready: ruflo._ready,
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── GET /api/ruflo/tools ──────────────────────────────────
router.get('/tools', async (req, res) => {
    try {
        const ruflo = getRufloClient();
        const available = await ruflo.isAvailable();

        if (!available) {
            return res.status(503).json({
                success: false,
                error: 'RuFlo MCP server is not available. Make sure it is running: npx ruflo mcp start -t http -p 8100',
            });
        }

        const tools = await ruflo.listTools();

        res.json({
            success: true,
            count: Array.isArray(tools) ? tools.length : 0,
            tools,
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── GET /api/ruflo/categories ─────────────────────────────
router.get('/categories', async (req, res) => {
    try {
        const ruflo = getRufloClient();
        const available = await ruflo.isAvailable();

        if (!available) {
            return res.status(503).json({
                success: false,
                error: 'RuFlo MCP server is not available.',
            });
        }

        const categories = await ruflo.getToolCategories();
        const summary = {};
        for (const [cat, tools] of Object.entries(categories)) {
            summary[cat] = Array.isArray(tools) ? tools.length : 0;
        }

        res.json({
            success: true,
            categories: summary,
            detailed: categories,
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── POST /api/ruflo/execute ───────────────────────────────
router.post('/execute', async (req, res) => {
    try {
        const { tool, params } = req.body;

        if (!tool) {
            return res.status(400).json({ success: false, error: 'tool name is required' });
        }

        const ruflo = getRufloClient();
        const available = await ruflo.isAvailable();

        if (!available) {
            return res.status(503).json({
                success: false,
                error: 'RuFlo MCP server is not available.',
            });
        }

        rufloLog('mcp', `API executing tool: ${tool}`, { params: JSON.stringify(params || {}).substring(0, 200) });

        const result = await ruflo.executeTool(tool, params || {});

        res.json({
            success: true,
            tool,
            result,
        });
    } catch (error) {
        rufloLog('error', `API tool execution failed: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
