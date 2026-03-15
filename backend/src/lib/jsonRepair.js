/**
 * JSON Repair Utility
 * 
 * Single-pass repair for LLM-generated JSON that handles:
 * - Backtick template literals (Llama models use these for code)
 * - Markdown code fences
 * - Trailing commas
 * - Truncated responses
 * - Control characters
 */

/**
 * Parse LLM response into a valid JSON object.
 * Applies all repairs in a single pass before parsing.
 * 
 * @param {string} raw - Raw LLM output (may contain markdown fences, backticks, etc.)
 * @returns {object} - Parsed JSON object
 * @throws {Error} - If the response cannot be parsed even after repair
 */
function parseWithRepair(raw) {
    if (!raw || typeof raw !== 'string') {
        throw new Error('Empty or non-string input');
    }

    let json = raw.trim();

    // 1. Strip markdown code fences
    const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
        json = fenceMatch[1].trim();
    } else {
        // Also handle case where content starts with ```json but has no closing fence (truncated)
        if (json.startsWith('```json')) json = json.slice(7).trim();
        else if (json.startsWith('```')) json = json.slice(3).trim();
        if (json.endsWith('```')) json = json.slice(0, -3).trim();
    }

    // 2. Strip any leading text before the first {
    const firstBrace = json.indexOf('{');
    if (firstBrace > 0) {
        json = json.substring(firstBrace);
    }

    // 3. Remove control characters (but keep \t \n \r which are valid in JSON strings)
    json = json.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

    // ──────────────────────────────────────────────────────────
    // FAST PATH: Try parsing the clean JSON directly FIRST.
    // Most LLM responses (especially fullCode) are valid JSON
    // and should NOT go through backtick conversion which can
    // corrupt regex patterns and special characters in code.
    // ──────────────────────────────────────────────────────────
    try {
        return JSON.parse(json);
    } catch (_fastErr) {
        // Fast path failed — continue to repair
    }

    // Also try with trailing-comma fix + truncation repair (no backtick mangling)
    let lightRepair = json.replace(/,\s*([\]}])/g, '$1');
    lightRepair = closeTruncated(lightRepair);
    try {
        return JSON.parse(lightRepair);
    } catch (_lightErr) {
        // Light repair failed — continue to heavy repair
    }

    // ──────────────────────────────────────────────────────────
    // HEAVY REPAIR: Only as a last resort, convert backticks.
    // This is needed for Llama models that use template literals.
    // ──────────────────────────────────────────────────────────
    let repaired = convertBackticksToStrings(json);
    repaired = repaired.replace(/,\s*([\]}])/g, '$1');
    repaired = closeTruncated(repaired);

    try {
        return JSON.parse(repaired);
    } catch (err) {
        console.error(`  ❌ JSON parse failed after all repair attempts: ${err.message}`);
        console.error(`  📝 Clean JSON (first 300 chars): ${json.substring(0, 300)}`);
        console.error(`  📝 Repaired JSON (first 300 chars): ${repaired.substring(0, 300)}`);
        throw new Error(
            `Failed to parse LLM response as JSON: ${err.message}\n` +
            `Raw response (first 500 chars): ${raw.substring(0, 500)}`
        );
    }
}

/**
 * Convert backtick template literals to proper JSON double-quoted strings.
 * 
 * LLMs (especially Llama) output things like:
 *   "newCode": `<div>\n  <p>hello</p>\n</div>`
 * 
 * This converts them to:
 *   "newCode": "<div>\\n  <p>hello</p>\\n</div>"
 */
function convertBackticksToStrings(json) {
    let result = '';
    let i = 0;
    let inString = false;
    let escapeNext = false;

    while (i < json.length) {
        const ch = json[i];

        // Track escape sequences inside JSON strings
        if (escapeNext) {
            escapeNext = false;
            result += ch;
            i++;
            continue;
        }

        // Inside a JSON double-quoted string — pass through everything
        if (inString) {
            if (ch === '\\') {
                escapeNext = true;
            } else if (ch === '"') {
                inString = false;
            }
            result += ch;
            i++;
            continue;
        }

        // Outside a string — handle quotes and backticks
        if (ch === '"') {
            inString = true;
            result += ch;
            i++;
        } else if (ch === '`') {
            // Backtick outside a JSON string — LLM used template literal as value
            // Find matching closing backtick
            let end = i + 1;
            while (end < json.length && json[end] !== '`') {
                end++;
            }

            if (end < json.length) {
                const content = json.substring(i + 1, end);
                const escaped = content
                    .replace(/\\/g, '\\\\')
                    .replace(/"/g, '\\"')
                    .replace(/\n/g, '\\n')
                    .replace(/\r/g, '\\r')
                    .replace(/\t/g, '\\t');
                result += '"' + escaped + '"';
                i = end + 1;
            } else {
                // No closing backtick (truncated) — convert what we have
                const content = json.substring(i + 1);
                const escaped = content
                    .replace(/\\/g, '\\\\')
                    .replace(/"/g, '\\"')
                    .replace(/\n/g, '\\n')
                    .replace(/\r/g, '\\r')
                    .replace(/\t/g, '\\t');
                result += '"' + escaped + '"';
                i = json.length;
            }
        } else {
            result += ch;
            i++;
        }
    }

    return result;
}

/**
 * Close truncated JSON by closing any unclosed strings, arrays, and objects.
 */
function closeTruncated(json) {
    let inString = false;
    let escapeNext = false;
    const stack = [];

    for (let i = 0; i < json.length; i++) {
        const ch = json[i];

        if (escapeNext) { escapeNext = false; continue; }
        if (ch === '\\' && inString) { escapeNext = true; continue; }

        if (ch === '"') {
            inString = !inString;
            continue;
        }

        if (inString) continue;

        if (ch === '{') stack.push('}');
        else if (ch === '[') stack.push(']');
        else if ((ch === '}' || ch === ']') && stack.length > 0 && stack[stack.length - 1] === ch) {
            stack.pop();
        }
    }

    if (stack.length === 0 && !inString) return json;

    // Close unclosed string
    if (inString) {
        json += '"';
    }

    // Remove trailing comma
    json = json.replace(/,\s*$/, '');

    // Close remaining brackets/braces
    return json + stack.reverse().join('');
}

module.exports = { parseWithRepair };
