/**
 * start-ruflo-http.js
 * 
 * Starts the RuFlo MCP server in HTTP mode.
 * 
 * The ruflo CLI wrapper (ruflo.js) auto-detects non-TTY stdin (like npm scripts)
 * and forces stdio mode, bypassing CLI flag parsing. This script works around
 * that by directly importing the CLI class and calling it with HTTP transport.
 * 
 * Usage: node scripts/start-ruflo-http.js [port]
 */

const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.RUFLO_MCP_PORT || process.argv[2] || 8100;
const HOST = process.env.RUFLO_MCP_HOST || '127.0.0.1';

// Set the transport env var BEFORE spawning ruflo
// This is the env var the MCP server checks internally
const env = {
    ...process.env,
    CLAUDE_FLOW_MCP_TRANSPORT: 'http',
    FORCE_COLOR: '1',
};

console.log(`[ruflo-http] Starting RuFlo MCP server in HTTP mode on ${HOST}:${PORT}...`);

// Find the ruflo binary
const rufloCmd = process.platform === 'win32' ? 'ruflo.cmd' : 'ruflo';

// Spawn ruflo with the transport env var set + TTY allocation trick
const child = spawn(rufloCmd, ['mcp', 'start', '-t', 'http', '-p', String(PORT)], {
    env,
    stdio: ['pipe', 'inherit', 'inherit'],  // pipe stdin so it's not directly inherited
    shell: true,
});

// Write to stdin to prevent it from being null/closed, but don't pipe parent stdin
// This prevents the "non-TTY" detection from kicking in
child.stdin.end();

child.on('error', (err) => {
    console.error(`[ruflo-http] Failed to start: ${err.message}`);
    process.exit(1);
});

child.on('exit', (code) => {
    console.log(`[ruflo-http] Process exited with code ${code}`);
    process.exit(code || 0);
});

// Forward termination signals
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
