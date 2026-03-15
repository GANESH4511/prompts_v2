/**
 * LLM Response Parser
 * 
 * High-level wrapper around jsonRepair for parsing structured
 * LLM responses.  Centralises logging and can be extended with
 * schema validation or response-type detection later.
 */

const { parseWithRepair } = require('./jsonRepair');

/**
 * Parse the LLM's JSON response, handling markdown fences,
 * truncated output, and edge cases.
 * Uses the shared JSON repair utility for robust parsing.
 *
 * @param {string}  raw      - Raw LLM text output
 * @param {Object} [options] - Optional settings
 * @param {string} [options.context] - Label for log messages (e.g. 'implement', 'theme')
 * @returns {Object} Parsed JSON object
 * @throws {Error}  If the response cannot be parsed even after repair
 */
function parseLLMResponse(raw, options = {}) {
    const label = options.context ? ` [${options.context}]` : '';

    if (!raw || typeof raw !== 'string') {
        throw new Error(`Empty or non-string LLM response${label}`);
    }

    try {
        const parsed = parseWithRepair(raw);
        return parsed;
    } catch (err) {
        // Re-throw with extra context so callers get a useful message
        throw new Error(
            `LLM response parse failure${label}: ${err.message}`
        );
    }
}

module.exports = { parseLLMResponse };
