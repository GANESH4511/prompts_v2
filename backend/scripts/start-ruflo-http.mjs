/**
 * start-ruflo-http.mjs
 * 
 * Starts a custom HTTP bridge that exposes ALL 239 RuFlo MCP tools over HTTP.
 * 
 * Problem: The @claude-flow/mcp HTTP transport only registers 4 system tools.
 * The full 239 tools are in mcp-client.js, only used by stdio mode.
 * 
 * Solution: We create our own HTTP server that imports mcp-client.js and
 * wraps listMCPTools() / callMCPTool() with JSON-RPC over HTTP — giving
 * the backend full access to all tools.
 * 
 * Usage: node backend/scripts/start-ruflo-http.mjs [port]
 */

import { createServer } from 'http';
import { join } from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { randomUUID } from 'crypto';

const PORT = parseInt(process.env.RUFLO_MCP_PORT || process.argv[2] || '8100', 10);
const HOST = process.env.RUFLO_MCP_HOST || '0.0.0.0';
const VERSION = '3.0.0';

// ── Find @claude-flow/cli ────────────────────────────────────
function findClaudeFlowCli() {
    const paths = [
        join(process.env.APPDATA || '', 'npm', 'node_modules', 'ruflo', 'node_modules', '@claude-flow', 'cli'),
        join(process.cwd(), 'node_modules', 'ruflo', 'node_modules', '@claude-flow', 'cli'),
        join(process.cwd(), 'node_modules', '@claude-flow', 'cli'),
    ];
    for (const p of paths) {
        if (existsSync(join(p, 'dist', 'src', 'mcp-client.js'))) return p;
    }
    return null;
}

const cliBase = findClaudeFlowCli();
if (!cliBase) {
    console.error('[ruflo-http] ❌ Could not find @claude-flow/cli. Is ruflo installed?');
    process.exit(1);
}

console.log('[ruflo-http] 🐝 Loading MCP tool registry...');

// Import the full tool registry (239 tools)
const clientPath = pathToFileURL(join(cliBase, 'dist', 'src', 'mcp-client.js')).href;
const { listMCPTools, callMCPTool, hasTool } = await import(clientPath);

const allTools = listMCPTools();
console.log(`[ruflo-http] 📦 Loaded ${allTools.length} tools`);

// ── JSON-RPC message handler ─────────────────────────────────
const sessionId = `mcp-http-${Date.now()}-${randomUUID().slice(0, 8)}`;

async function handleRPC(message) {
    if (!message.method) {
        return {
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32600, message: 'Invalid Request: missing method' },
        };
    }

    const params = message.params || {};

    try {
        switch (message.method) {
            case 'initialize':
                return {
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        protocolVersion: '2024-11-05',
                        serverInfo: { name: 'ruflo-mcp-http', version: VERSION },
                        capabilities: {
                            tools: { listChanged: true },
                            resources: { subscribe: true, listChanged: true },
                        },
                    },
                };

            case 'tools/list':
                return {
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        tools: allTools.map(t => ({
                            name: t.name,
                            description: t.description,
                            inputSchema: t.inputSchema,
                        })),
                    },
                };

            case 'tools/call':
                const toolName = params.name;
                const toolParams = params.arguments || {};

                if (!hasTool(toolName)) {
                    return {
                        jsonrpc: '2.0',
                        id: message.id,
                        error: { code: -32601, message: `Tool not found: ${toolName}` },
                    };
                }

                try {
                    const result = await callMCPTool(toolName, toolParams, { sessionId });
                    return {
                        jsonrpc: '2.0',
                        id: message.id,
                        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
                    };
                } catch (error) {
                    return {
                        jsonrpc: '2.0',
                        id: message.id,
                        error: {
                            code: -32603,
                            message: error instanceof Error ? error.message : 'Tool execution failed',
                        },
                    };
                }

            case 'notifications/initialized':
                return null; // No response needed

            case 'ping':
                return { jsonrpc: '2.0', id: message.id, result: {} };

            default:
                return {
                    jsonrpc: '2.0',
                    id: message.id,
                    error: { code: -32601, message: `Method not found: ${message.method}` },
                };
        }
    } catch (error) {
        return {
            jsonrpc: '2.0',
            id: message.id,
            error: {
                code: -32603,
                message: error instanceof Error ? error.message : 'Internal error',
            },
        };
    }
}

// ── HTTP Server ──────────────────────────────────────────────
const server = createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Health endpoint
    if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            version: VERSION,
            tools: allTools.length,
            uptime: process.uptime(),
            sessionId,
        }));
        return;
    }

    // JSON-RPC endpoint
    if (req.url === '/rpc' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;

        try {
            const message = JSON.parse(body);
            const response = await handleRPC(message);

            if (response === null) {
                res.writeHead(204);
                res.end();
                return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));
        } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32700, message: 'Parse error' },
            }));
        }
        return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found', endpoints: ['/health', '/rpc'] }));
});

server.listen(PORT, HOST, () => {
    console.log(`[ruflo-http] ✅ MCP HTTP Bridge running!`);
    console.log(`[ruflo-http]    Health:  http://${HOST}:${PORT}/health`);
    console.log(`[ruflo-http]    RPC:     http://${HOST}:${PORT}/rpc`);
    console.log(`[ruflo-http]    Tools:   ${allTools.length} tools available`);
    console.log(`[ruflo-http]    PID:     ${process.pid}`);
    console.log(`[ruflo-http]    Session: ${sessionId}`);
});

// Graceful shutdown
function shutdown() {
    console.log('[ruflo-http] Shutting down...');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
