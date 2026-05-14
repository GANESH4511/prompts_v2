/**
 * rufloLogger.js
 *
 * Structured logging for the RuFlo multi-agent pipeline.
 *
 * Two layers:
 *   - Backend console: verbose (agent IDs, MCP calls, timings, patches)
 *   - Frontend SSE:    abstract (user-friendly progress messages)
 */

const PREFIXES = {
    pipeline:  '🏗️  PIPELINE ',
    architect: '🧠  ARCHITECT',
    spawn:     '🚀  SPAWN    ',
    mcp:       '📡  MCP CALL ',
    agent:     '⚙️  AGENT    ',
    merge:     '🔀  MERGE    ',
    done:      '✅  DONE     ',
    error:     '❌  ERROR    ',
    parallel:  '⏳  PARALLEL ',
    fallback:  '⚠️  FALLBACK ',
    swarm:     '🐝  SWARM    ',
    context:   '📦  CONTEXT  ',
    token:     '🎯  TOKEN    ',
    config:    '⚙️  CONFIG   ',
};

/**
 * Log a verbose message to the backend console.
 *
 * @param {string} category  — one of the PREFIXES keys
 * @param {string} message   — human-readable description
 * @param {object} [data]    — key/value pairs appended as " | key=value"
 */
function rufloLog(category, message, data = {}) {
    const prefix = PREFIXES[category] || '📌  INFO     ';
    const pairs = Object.entries(data)
        .filter(([k]) => !k.startsWith('_'))
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
    const suffix = pairs ? ` | ${pairs}` : '';
    console.log(`[ruflo] ${prefix} | ${message}${suffix}`);
}

/**
 * User-facing status messages mapped from internal pipeline stages.
 * Returns the abstract text to send via SSE to the frontend.
 */
const USER_MESSAGES = {
    architect_start:   'Analyzing your change request...',
    architect_done:    'Analysis complete.',
    agents_spawning:   (count) => `Working on ${count} modification${count > 1 ? 's' : ''}...`,
    agents_running:    'Generating code changes...',
    merge_start:       'Finalizing changes...',
    merge_done:        'Changes ready for review.',
    retry:             (attempt, max) => `Retrying... (${attempt}/${max})`,
    fallback_normal:   'Using standard pipeline...',
    error_generic:     'Something went wrong. Retrying...',
    error_final:       'Could not generate changes. Try rephrasing your request.',
};

/**
 * Send an abstract status event to the frontend via SSE.
 *
 * @param {function} sendEvent — the SSE sendEvent(type, data) helper from implement.js
 * @param {string} stage       — one of the USER_MESSAGES keys
 * @param {*} [arg]            — optional argument for dynamic messages
 */
function sendUserStatus(sendEvent, stage, arg) {
    const msgOrFn = USER_MESSAGES[stage];
    const message = typeof msgOrFn === 'function' ? msgOrFn(arg) : (msgOrFn || stage);
    sendEvent('status', { message });
}

module.exports = { rufloLog, sendUserStatus, USER_MESSAGES };
