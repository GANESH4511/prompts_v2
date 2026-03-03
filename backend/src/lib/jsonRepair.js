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

    // 3. Remove control characters
    json = json.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

    // 4. Convert backtick template literals to JSON strings
    json = convertBackticksToStrings(json);

    // 5. Fix trailing commas
    json = json.replace(/,\s*([\]}])/g, '$1');

    // 6. Close truncated JSON (unclosed brackets/braces/strings)
    json = closeTruncated(json);

    // Parse
    try {
        return JSON.parse(json);
    } catch (err) {
        console.error(`  ❌ JSON parse failed after repair: ${err.message}`);
        console.error(`  📝 Repaired JSON (first 300 chars): ${json.substring(0, 300)}`);
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

    while (i < json.length) {
        if (json[i] === '`') {
            // Check if preceded by : (value position) — e.g. "key": `value`
            const before = result.trimEnd();
            const isValuePosition = before.endsWith(':');

            // Find matching closing backtick
            let end = i + 1;
            while (end < json.length && json[end] !== '`') {
                end++;
            }

            if (end < json.length) {
                // Found closing backtick — convert to JSON string
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
            result += json[i];
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
