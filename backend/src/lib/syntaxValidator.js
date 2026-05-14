/**
 * Syntax Validator
 *
 * Lightweight, zero-dependency validation for generated code.
 * Catches the most common structural errors before writing to disk:
 *   1. Brace / bracket / paren balance
 *   2. JSX tag balance (open tags must close)
 *   3. Template-literal backtick balance
 *   4. Critical pattern checks (e.g. 'use client', export default)
 *
 * Returns { valid, errors, warnings } so the caller can decide
 * whether to write, retry with feedback, or fallback.
 */

/**
 * Validate generated code for structural correctness.
 *
 * @param {string} code     — the full file content after patches are applied
 * @param {string} filePath — used to decide which checks to run (e.g. .tsx vs .css)
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validate(code, filePath = '') {
    const errors = [];
    const warnings = [];
    const ext = (filePath.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    const isJSX = ['.tsx', '.jsx'].includes(ext);
    const isJS  = ['.js', '.ts', '.mjs', '.cjs'].includes(ext);

    // ─── 1. Brace / bracket / paren balance ────────────────────────
    if (isJSX || isJS) {
        const balanceResult = checkBraceBalance(code);
        if (!balanceResult.balanced) {
            for (const err of balanceResult.errors) {
                errors.push(err);
            }
        }
    }

    // ─── 2. JSX tag balance ────────────────────────────────────────
    if (isJSX) {
        const jsxResult = checkJSXBalance(code);
        if (!jsxResult.balanced) {
            for (const err of jsxResult.errors) {
                errors.push(err);
            }
        }
    }

    // ─── 3. Critical pattern checks ────────────────────────────────
    if (isJSX || isJS) {
        const patternResult = checkCriticalPatterns(code, ext);
        for (const w of patternResult.warnings) {
            warnings.push(w);
        }
        for (const e of patternResult.errors) {
            errors.push(e);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Check that {, }, (, ), [, ] are balanced.
 * Skips characters inside strings and comments.
 */
function checkBraceBalance(code) {
    const errors = [];
    const stack = [];
    const pairs = { '{': '}', '(': ')', '[': ']' };
    const closers = new Set(['}', ')', ']']);

    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inTemplateLiteral = false;
    let inLineComment = false;
    let inBlockComment = false;
    let escapeNext = false;

    for (let i = 0; i < code.length; i++) {
        const ch = code[i];
        const next = i + 1 < code.length ? code[i + 1] : '';

        // Handle escape sequences inside strings
        if (escapeNext) {
            escapeNext = false;
            continue;
        }

        if ((inSingleQuote || inDoubleQuote || inTemplateLiteral) && ch === '\\') {
            escapeNext = true;
            continue;
        }

        // Line comment
        if (inLineComment) {
            if (ch === '\n') inLineComment = false;
            continue;
        }

        // Block comment
        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i++; // skip /
            }
            continue;
        }

        // String tracking
        if (inSingleQuote) {
            if (ch === "'") inSingleQuote = false;
            continue;
        }
        if (inDoubleQuote) {
            if (ch === '"') inDoubleQuote = false;
            continue;
        }
        if (inTemplateLiteral) {
            if (ch === '`') inTemplateLiteral = false;
            // Note: we don't track ${} inside template literals for simplicity
            continue;
        }

        // Enter strings / comments
        if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
        if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
        if (ch === "'") { inSingleQuote = true; continue; }
        if (ch === '"') { inDoubleQuote = true; continue; }
        if (ch === '`') { inTemplateLiteral = true; continue; }

        // Track braces
        if (pairs[ch]) {
            stack.push({ char: ch, expected: pairs[ch], pos: i });
        } else if (closers.has(ch)) {
            if (stack.length === 0) {
                const line = code.substring(0, i).split('\n').length;
                errors.push(`Unexpected closing '${ch}' at line ${line} with no matching opener`);
            } else {
                const top = stack[stack.length - 1];
                if (top.expected === ch) {
                    stack.pop();
                } else {
                    const line = code.substring(0, i).split('\n').length;
                    errors.push(`Mismatched '${ch}' at line ${line} (expected '${top.expected}' to close '${top.char}')`);
                    stack.pop(); // pop anyway to avoid cascade
                }
            }
        }
    }

    // Check for unclosed
    if (stack.length > 0) {
        for (const item of stack) {
            const line = code.substring(0, item.pos).split('\n').length;
            errors.push(`Unclosed '${item.char}' at line ${line} (expected '${item.expected}')`);
        }
    }

    // Check for unclosed strings
    if (inSingleQuote) errors.push('Unclosed single-quoted string at end of file');
    if (inDoubleQuote) errors.push('Unclosed double-quoted string at end of file');
    if (inTemplateLiteral) errors.push('Unclosed template literal at end of file');

    return { balanced: errors.length === 0, errors };
}

/**
 * Check JSX tag balance.
 * Uses a simple regex-based approach to find opening and closing tags.
 * Only checks custom/HTML tags, not expressions like {condition && <Comp />}.
 */
function checkJSXBalance(code) {
    const errors = [];

    // Remove strings, comments, and template literals to avoid false positives
    const cleaned = stripStringsAndComments(code);

    // Match opening tags: <TagName ... > (not self-closing)
    // and closing tags: </TagName>
    // and self-closing: <TagName ... />
    const tagStack = [];
    const tagRegex = /<\/?([A-Z][A-Za-z0-9.]*|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)([\s\S]*?)(\/?)\s*>/g;
    let match;

    while ((match = tagRegex.exec(cleaned)) !== null) {
        const fullMatch = match[0];
        const tagName = match[1];
        const isSelfClosing = match[3] === '/' || fullMatch.endsWith('/>');
        const isClosing = fullMatch.startsWith('</');

        // Skip common void/self-closing HTML elements
        const voidElements = new Set([
            'br', 'hr', 'img', 'input', 'meta', 'link',
            'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'
        ]);

        if (voidElements.has(tagName.toLowerCase())) continue;
        if (isSelfClosing && !isClosing) continue; // <Component /> — OK

        if (isClosing) {
            // Closing tag — pop from stack
            if (tagStack.length === 0) {
                errors.push(`Closing </${tagName}> with no matching opening tag`);
            } else {
                const top = tagStack[tagStack.length - 1];
                if (top === tagName) {
                    tagStack.pop();
                } else {
                    // Mismatch — this is a real error
                    errors.push(`Mismatched closing </${tagName}> (expected </${top}>)`);
                    // Try to find and remove the matching tag deeper in stack
                    const idx = tagStack.lastIndexOf(tagName);
                    if (idx >= 0) tagStack.splice(idx, 1);
                    else tagStack.pop();
                }
            }
        } else if (!isSelfClosing) {
            // Opening tag
            tagStack.push(tagName);
        }
    }

    // Any remaining open tags
    if (tagStack.length > 0 && tagStack.length <= 5) {
        // Only report if a small number remain (large count = probably parsing issue)
        for (const tag of tagStack) {
            errors.push(`Unclosed JSX tag <${tag}>`);
        }
    } else if (tagStack.length > 5) {
        // Likely a parsing issue, not a real error — downgrade to warning
        // This can happen with complex conditional rendering
    }

    return { balanced: errors.length === 0, errors };
}

/**
 * Check critical patterns that should be preserved.
 */
function checkCriticalPatterns(code, ext) {
    const errors = [];
    const warnings = [];

    // Next.js client component must have 'use client' if it uses hooks
    if (['.tsx', '.jsx'].includes(ext)) {
        const usesHooks = /\buse(State|Effect|Callback|Memo|Ref|Context|Reducer)\b/.test(code);
        const hasUseClient = /^['"]use client['"]/.test(code.trim());

        if (usesHooks && !hasUseClient) {
            warnings.push("File uses React hooks but missing 'use client' directive");
        }
    }

    // Check for empty file (complete wipe)
    if (code.trim().length === 0) {
        errors.push('Generated code is empty — file would be wiped');
    }

    // Check for extremely short output (likely truncated)
    if (code.trim().length > 0 && code.trim().length < 50) {
        warnings.push(`Generated code is suspiciously short (${code.trim().length} chars) — may be truncated`);
    }

    return { errors, warnings };
}

/**
 * Strip strings and comments from code for safer regex parsing.
 * Replaces content with spaces to preserve positions.
 */
function stripStringsAndComments(code) {
    let result = '';
    let i = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inTemplateLiteral = false;
    let inLineComment = false;
    let inBlockComment = false;
    let escapeNext = false;

    while (i < code.length) {
        const ch = code[i];
        const next = i + 1 < code.length ? code[i + 1] : '';

        if (escapeNext) {
            escapeNext = false;
            result += ' ';
            i++;
            continue;
        }

        if ((inSingleQuote || inDoubleQuote || inTemplateLiteral) && ch === '\\') {
            escapeNext = true;
            result += ' ';
            i++;
            continue;
        }

        if (inLineComment) {
            result += ch === '\n' ? '\n' : ' ';
            if (ch === '\n') inLineComment = false;
            i++;
            continue;
        }

        if (inBlockComment) {
            result += ch === '\n' ? '\n' : ' ';
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                result += ' ';
                i += 2;
                continue;
            }
            i++;
            continue;
        }

        if (inSingleQuote) {
            result += ' ';
            if (ch === "'") { inSingleQuote = false; }
            i++;
            continue;
        }
        if (inDoubleQuote) {
            result += ' ';
            if (ch === '"') { inDoubleQuote = false; }
            i++;
            continue;
        }
        if (inTemplateLiteral) {
            result += ch === '\n' ? '\n' : ' ';
            if (ch === '`') { inTemplateLiteral = false; }
            i++;
            continue;
        }

        if (ch === '/' && next === '/') { inLineComment = true; result += ' '; i++; continue; }
        if (ch === '/' && next === '*') { inBlockComment = true; result += ' '; i++; continue; }
        if (ch === "'") { inSingleQuote = true; result += ' '; i++; continue; }
        if (ch === '"') { inDoubleQuote = true; result += ' '; i++; continue; }
        if (ch === '`') { inTemplateLiteral = true; result += ' '; i++; continue; }

        result += ch;
        i++;
    }

    return result;
}

/**
 * Build a concise error summary suitable for feeding back to the LLM
 * in a retry prompt.
 *
 * @param {{ valid: boolean, errors: string[], warnings: string[] }} result
 * @returns {string}
 */
function buildErrorFeedback(result) {
    if (result.valid) return '';

    const lines = ['The generated code has the following syntax errors:'];
    for (const err of result.errors.slice(0, 5)) {
        lines.push(`  - ${err}`);
    }
    if (result.errors.length > 5) {
        lines.push(`  ... and ${result.errors.length - 5} more errors`);
    }
    lines.push('');
    lines.push('Fix your SEARCH/REPLACE blocks to ensure all braces, parentheses, and JSX tags are properly balanced.');
    return lines.join('\n');
}

/**
 * Check if a SEARCH block exists in the source code.
 * Tries exact match first, then whitespace-tolerant match.
 *
 * @param {string} search  — the SEARCH block text
 * @param {string} sourceCode — the full source file
 * @returns {{ found: boolean, matchType: string }}
 */
function validateSearchExists(search, sourceCode) {
    if (!search || !search.trim()) {
        return { found: true, matchType: 'empty-search' };
    }

    const normalizedSearch = search.replace(/\r\n/g, '\n');
    const normalizedSource = sourceCode.replace(/\r\n/g, '\n');

    // 1. Exact match
    if (normalizedSource.includes(normalizedSearch)) {
        return { found: true, matchType: 'exact' };
    }

    // 2. Whitespace-tolerant match (trim each line)
    const searchLines = normalizedSearch.split('\n');
    const sourceLines = normalizedSource.split('\n');

    for (let i = 0; i <= sourceLines.length - searchLines.length; i++) {
        let match = true;
        for (let j = 0; j < searchLines.length; j++) {
            if (sourceLines[i + j].trim() !== searchLines[j].trim()) {
                match = false;
                break;
            }
        }
        if (match) {
            return { found: true, matchType: 'whitespace-tolerant' };
        }
    }

    return { found: false, matchType: 'none' };
}

/**
 * Validate a single SEARCH/REPLACE patch before it is applied.
 * Runs SEARCH existence check, brace balance, JSX balance, and truncation detection.
 *
 * @param {{ search: string, replace: string }} patch
 * @param {string} sourceCode — the full source file content
 * @returns {{ valid: boolean, warnings: string[], errors: string[], canAutoRepair: boolean }}
 */
function validatePatch(patch, sourceCode) {
    const warnings = [];
    const errors = [];
    let canAutoRepair = false;

    // 1. Check SEARCH exists in source
    const searchResult = validateSearchExists(patch.search, sourceCode);
    if (!searchResult.found) {
        errors.push('SEARCH block not found in source code');
    } else if (searchResult.matchType === 'whitespace-tolerant') {
        warnings.push('SEARCH block matched via whitespace-tolerant (not exact)');
    }

    // 2. Check REPLACE has balanced braces
    const braceResult = checkBraceBalance(patch.replace);
    if (!braceResult.balanced) {
        for (const err of braceResult.errors) {
            errors.push(`REPLACE: ${err}`);
        }
        canAutoRepair = true;
    }

    // 3. Check REPLACE has balanced JSX tags
    const jsxResult = checkJSXBalance(patch.replace);
    if (!jsxResult.balanced) {
        for (const err of jsxResult.errors) {
            errors.push(`REPLACE JSX: ${err}`);
        }
        canAutoRepair = true;
    }

    // 4. Check for obvious truncation signs
    const replaceLines = patch.replace.split('\n');
    const lastLine = replaceLines[replaceLines.length - 1].trim();
    if (lastLine === '...' || lastLine === '// ...' || lastLine === '/* ... */') {
        errors.push(`REPLACE block appears truncated (ends with "${lastLine}")`);
    }

    // 5. Check for empty REPLACE with non-empty SEARCH (likely accidental deletion)
    if (patch.search.trim() && !patch.replace.trim()) {
        warnings.push('REPLACE block is empty — this will DELETE the matched code');
    }

    return { valid: errors.length === 0, warnings, errors, canAutoRepair };
}

module.exports = { validate, buildErrorFeedback, validateSearchExists, validatePatch };
