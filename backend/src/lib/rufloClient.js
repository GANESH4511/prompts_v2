/**
 * rufloClient.js
 *
 * Thin HTTP client that calls the RuFlo MCP server.
 * All multi-agent orchestration flows through this module.
 *
 * RuFlo MCP must be running:  npx ruflo mcp start -t http -p 8100
 */

const { rufloLog } = require('./rufloLogger');

const DEFAULT_BASE_URL = 'http://localhost:8100';
const AGENT_TIMEOUT_MS = 90_000;   // 90 seconds per agent
const HEALTH_TIMEOUT_MS = 5_000;   // 5 seconds for health check (increased for startup)
const POLL_INTERVAL_MS  = 1_000;   // poll agent status every 1s
const STARTUP_RETRY_MS  = 2_000;   // retry interval during startup
const STARTUP_MAX_RETRIES = 10;    // max retries waiting for MCP server

class RufloClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl || process.env.RUFLO_MCP_URL || DEFAULT_BASE_URL;
        this._toolsCache = null;
        this._toolsCacheTime = 0;
        this._ready = false;
    }

    // ── Core MCP tool call (JSON-RPC 2.0 over HTTP) ───────────────
    async callTool(toolName, params = {}) {
        rufloLog('mcp', `Calling tool: ${toolName}`, { params: JSON.stringify(params).substring(0, 200) });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

        try {
            const res = await fetch(`${this.baseUrl}/rpc`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method: 'tools/call',
                    params: { name: toolName, arguments: params },
                }),
                signal: controller.signal,
            });

            if (!res.ok) {
                const errText = await res.text().catch(() => 'Unknown error');
                throw new Error(`MCP tool ${toolName} failed (${res.status}): ${errText}`);
            }

            const data = await res.json();

            if (data.error) {
                throw new Error(`MCP tool ${toolName} error: ${data.error.message || JSON.stringify(data.error)}`);
            }

            // Extract text content from MCP response format
            const result = data.result;
            if (result && result.content && Array.isArray(result.content)) {
                const textContent = result.content.find(c => c.type === 'text');
                if (textContent) {
                    try { return JSON.parse(textContent.text); } catch { return textContent.text; }
                }
            }

            rufloLog('mcp', `Tool ${toolName} returned`, { success: true });
            return result;
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new Error(`MCP tool ${toolName} timed out after ${AGENT_TIMEOUT_MS}ms`);
            }
            throw err;
        } finally {
            clearTimeout(timeout);
        }
    }

    // ── Health check — returns true if MCP server is reachable ──
    async isAvailable() {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

            const res = await fetch(`${this.baseUrl}/health`, {
                method: 'GET',
                signal: controller.signal,
            }).catch(() => null);

            clearTimeout(timeout);

            if (res && res.ok) {
                rufloLog('config', 'RuFlo MCP server is available');
                this._ready = true;
                return true;
            }

            // Try alternate health endpoint
            const res2 = await fetch(`${this.baseUrl}/mcp/tool`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tool: 'config_get', arguments: { key: 'version' } }),
                signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
            }).catch(() => null);

            if (res2 && res2.ok) {
                rufloLog('config', 'RuFlo MCP server is available (via config_get)');
                this._ready = true;
                return true;
            }

            rufloLog('fallback', 'RuFlo MCP server is not reachable');
            return false;
        } catch {
            rufloLog('fallback', 'RuFlo MCP server health check failed');
            return false;
        }
    }

    /**
     * Wait for the MCP server to become available during startup.
     * Retries up to STARTUP_MAX_RETRIES times with STARTUP_RETRY_MS delay.
     */
    async waitForReady() {
        if (this._ready) return true;

        rufloLog('config', `Waiting for RuFlo MCP server at ${this.baseUrl}...`);

        for (let i = 1; i <= STARTUP_MAX_RETRIES; i++) {
            const available = await this.isAvailable();
            if (available) {
                rufloLog('config', `RuFlo MCP server ready after ${i} attempt(s)`);
                return true;
            }
            if (i < STARTUP_MAX_RETRIES) {
                rufloLog('config', `MCP server not ready, retry ${i}/${STARTUP_MAX_RETRIES} in ${STARTUP_RETRY_MS}ms...`);
                await new Promise(r => setTimeout(r, STARTUP_RETRY_MS));
            }
        }

        rufloLog('fallback', `RuFlo MCP server not available after ${STARTUP_MAX_RETRIES} retries`);
        return false;
    }

    // ── Tool discovery — list all available MCP tools ──────────────
    async listTools() {
        // Return cached tools if fresh (5 min cache)
        const now = Date.now();
        if (this._toolsCache && (now - this._toolsCacheTime) < 300_000) {
            return this._toolsCache;
        }

        rufloLog('mcp', 'Fetching available tools list via JSON-RPC');
        try {
            const res = await fetch(`${this.baseUrl}/rpc`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method: 'tools/list',
                    params: {},
                }),
                signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
            }).catch(() => null);

            if (res && res.ok) {
                const data = await res.json();
                if (data.result && data.result.tools) {
                    this._toolsCache = data.result.tools;
                    this._toolsCacheTime = now;
                    rufloLog('mcp', `Discovered ${this._toolsCache.length} tools`);
                    return this._toolsCache;
                }
            }

            rufloLog('error', 'Could not fetch tools list');
            return [];
        } catch (err) {
            rufloLog('error', `Tools list fetch failed: ${err.message}`);
            return [];
        }
    }

    // ── Execute any tool by name ──────────────────────────────────
    async executeTool(toolName, params = {}) {
        rufloLog('mcp', `Executing tool: ${toolName}`, { params: JSON.stringify(params).substring(0, 200) });
        return this.callTool(toolName, params);
    }

    // ── Get tools grouped by category ─────────────────────────────
    async getToolCategories() {
        const tools = await this.listTools();
        if (!Array.isArray(tools)) return {};

        const categories = {};
        for (const tool of tools) {
            const name = tool.name || tool;
            const parts = name.split('_');
            const category = parts[0] || 'uncategorized';
            if (!categories[category]) categories[category] = [];
            categories[category].push(tool);
        }
        return categories;
    }

    // ── Swarm management ────────────────────────────────────────
    async initSwarm(topology = 'centralized') {
        rufloLog('swarm', 'Initializing swarm', { topology });
        return this.callTool('swarm_init', {
            topology,
            maxAgents: 5,
            strategy: 'specialized',
        });
    }

    async shutdownSwarm() {
        rufloLog('swarm', 'Shutting down swarm');
        try {
            return await this.callTool('swarm_shutdown', {});
        } catch (err) {
            rufloLog('error', `Swarm shutdown error (non-fatal): ${err.message}`);
            return null;
        }
    }

    async getSwarmStatus() {
        return this.callTool('swarm_status', {});
    }

    // ── Agent management ────────────────────────────────────────
    async spawnAgent(type, config = {}) {
        rufloLog('spawn', `Spawning agent`, { type, ...config });
        return this.callTool('agent_spawn', {
            type,
            name: config.name || `${type}-${Date.now()}`,
            ...config,
        });
    }

    async getAgentStatus(agentId) {
        return this.callTool('agent_status', { agentId });
    }

    async stopAgent(agentId) {
        rufloLog('agent', `Stopping agent`, { agentId });
        return this.callTool('agent_terminate', { agentId });
    }

    // ── Task management ─────────────────────────────────────────
    async createTask(description, context = {}) {
        rufloLog('agent', `Creating task`, { description: description.substring(0, 100) });
        return this.callTool('hooks_pre-task', {
            task: description,
            context: JSON.stringify(context),
        });
    }

    async completeTask(taskId, success, outcome) {
        return this.callTool('hooks_post-task', {
            taskId,
            success,
            outcome,
        });
    }

    // ── Memory (shared context between agents) ──────────────────
    async storeMemory(key, value, metadata = {}) {
        return this.callTool('memory_store', {
            key,
            value: typeof value === 'string' ? value : JSON.stringify(value),
            ...metadata,
        });
    }

    async retrieveMemory(key) {
        return this.callTool('memory_retrieve', { key });
    }

    // ── Wait for multiple agents to complete ────────────────────
    async waitForAgents(agentIds, timeoutMs = AGENT_TIMEOUT_MS) {
        rufloLog('parallel', `Waiting for ${agentIds.length} agents`, { timeout: `${timeoutMs}ms` });

        const startTime = Date.now();
        const results = new Map();
        const pending = new Set(agentIds);

        while (pending.size > 0) {
            if (Date.now() - startTime > timeoutMs) {
                rufloLog('error', `Agent wait timed out after ${timeoutMs}ms`, { 
                    completed: results.size, 
                    pending: pending.size 
                });
                // Return what we have
                break;
            }

            for (const agentId of [...pending]) {
                try {
                    const status = await this.getAgentStatus(agentId);
                    if (status && (status.state === 'completed' || status.state === 'done' || status.state === 'failed')) {
                        results.set(agentId, status);
                        pending.delete(agentId);
                        rufloLog('done', `Agent completed`, { agentId, state: status.state });
                    }
                } catch {
                    // Agent might not be ready yet, continue polling
                }
            }

            if (pending.size > 0) {
                await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            }
        }

        return results;
    }

    // ── Route task to optimal agent ─────────────────────────────
    async routeTask(taskDescription) {
        return this.callTool('hooks_route', {
            task: taskDescription,
        });
    }
}

// Singleton
let _instance = null;
function getRufloClient() {
    if (!_instance) _instance = new RufloClient();
    return _instance;
}

module.exports = { RufloClient, getRufloClient };
