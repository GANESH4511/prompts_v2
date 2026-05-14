/**
 * syntaxAutoRepair.js
 *
 * Attempts to automatically repair common structural errors in LLM-generated
 * REPLACE blocks. This is a last-resort safety net — if the validator flags
 * a problem, we try to fix it before discarding the patch entirely.
 *
 * Handles three categories:
 *   1. Missing closing braces/parens/brackets
 *   2. Unclosed JSX tags
 *   3. Orphaned trailing syntax (stray `);`, `};`, etc.)
 */

/**
 * Attempt to repair unbalanced braces in code.
 * Counts open vs close for {}, (), [] and appends missing closers.
 *
 * @param {string} code
 * @returns {{ repaired: boolean, code: string, fixes: string[] }}
 */
function repairBraces(code) {
    const fixes = [];
    const counts = { '{': 0, '}': 0, '(': 0, ')': 0, '[': 0, ']': 0 };

    let inString = false;
    let stringChar = '';
    let inLineComment = false;
    let inBlockComment = false;
    let inTemplateLiteral = false;
    let escapeNext = false;

    for (let i = 0; i < code.length; i++) {
        const ch = code[i];
        const next = code[i + 1];

        if (escapeNext) { escapeNext = false; continue; }
        if ((inString || inTemplateLiteral) && ch === '\\') { escapeNext = true; continue; }

        // Comment handling
        if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
        if (inBlockComment) {
            if (ch === '*' && next === '/') { inBlockComment = false; i++; }
            continue;
        }

        // String handling
        if (inString) { if (ch === stringChar) inString = false; continue; }
        if (inTemplateLiteral) { if (ch === '`') inTemplateLiteral = false; continue; }

        // Enter strings/comments
        if (ch === '/' && next === '/') { inLineComment = true; continue; }
        if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
        if (ch === "'" || ch === '"') { inString = true; stringChar = ch; continue; }
        if (ch === '`') { inTemplateLiteral = true; continue; }

        // Count brackets
        if (counts.hasOwnProperty(ch)) {
            counts[ch]++;
        }
    }

    let result = code;
    let repaired = false;

    // Detect last indentation level for appending
    const lines = code.split('\n');
    const lastNonEmptyLine = [...lines].reverse().find(l => l.trim().length > 0) || '';
    const baseIndent = lastNonEmptyLine.match(/^(\s*)/)[1];

    // Fix missing closing braces
    const missingBraces = counts['{'] - counts['}'];
    if (missingBraces > 0 && missingBraces <= 3) {
        for (let i = 0; i < missingBraces; i++) {
            // Reduce indentation for each closing brace
            const indent = baseIndent.length > 2 * (i + 1)
                ? ' '.repeat(baseIndent.length - 2 * (i + 1))
                : '';
            result += `\n${indent}}`;
        }
        fixes.push(`Added ${missingBraces} missing closing brace(s)`);
        repaired = true;
    }

    // Fix missing closing parens
    const missingParens = counts['('] - counts[')'];
    if (missingParens > 0 && missingParens <= 3) {
        result += ')'.repeat(missingParens);
        fixes.push(`Added ${missingParens} missing closing paren(s)`);
        repaired = true;
    }

    // Fix missing closing brackets
    const missingBrackets = counts['['] - counts[']'];
    if (missingBrackets > 0 && missingBrackets <= 3) {
        result += ']'.repeat(missingBrackets);
        fixes.push(`Added ${missingBrackets} missing closing bracket(s)`);
        repaired = true;
    }

    return { repaired, code: result, fixes };
}

/**
 * Attempt to repair unclosed JSX tags.
 * Finds opening tags without matching closers and appends closing tags.
 *
 * @param {string} code
 * @returns {{ repaired: boolean, code: string, fixes: string[] }}
 */
function repairJsxTags(code) {
    const fixes = [];
    const stack = [];

    const voidElements = new Set([
        'br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base',
        'col', 'embed', 'source', 'track', 'wbr'
    ]);

    // Match JSX tags
    const tagRegex = /<\/?([A-Za-z][A-Za-z0-9.]*)[^>]*\/?>/g;
    let match;

    while ((match = tagRegex.exec(code)) !== null) {
        const fullTag = match[0];
        const tagName = match[1];

        if (voidElements.has(tagName.toLowerCase())) continue;
        if (fullTag.endsWith('/>')) continue;

        if (fullTag.startsWith('</')) {
            // Closing tag — try to match
            if (stack.length > 0 && stack[stack.length - 1] === tagName) {
                stack.pop();
            }
        } else {
            stack.push(tagName);
        }
    }

    let result = code;
    let repaired = false;

    // Close unclosed tags (max 3 to avoid runaway repairs)
    if (stack.length > 0 && stack.length <= 3) {
        const closers = stack.reverse().map(tag => `</${tag}>`).join('\n');
        result += `\n${closers}`;
        fixes.push(`Added closing tags: ${stack.map(t => `</${t}>`).join(', ')}`);
        repaired = true;
    }

    return { repaired, code: result, fixes };
}

/**
 * Remove orphaned trailing syntax that causes "Unexpected token" errors.
 * E.g. stray `);`, `};`, `}` at the end of a REPLACE block that doesn't
 * belong to any open structure.
 *
 * @param {string} code
 * @returns {{ repaired: boolean, code: string, fixes: string[] }}
 */
function repairTrailingCode(code) {
    const fixes = [];
    let result = code;
    let repaired = false;

    // Pattern: trailing orphaned closers after the logical end of code
    // e.g. a function that ends properly but has extra `});` after it
    const lines = result.split('\n');

    // Check last few lines for orphaned syntax
    let linesToCheck = Math.min(3, lines.length);
    let removedLines = 0;

    for (let i = lines.length - 1; i >= lines.length - linesToCheck && i >= 0; i--) {
        const trimmed = lines[i].trim();

        // Check if line is ONLY closing syntax with no matching opener in the block
        if (/^[}\])\s;,]+$/.test(trimmed)) {
            // Count total opens and closes up to this point
            const codeAbove = lines.slice(0, i).join('\n');
            const opensAbove = (codeAbove.match(/[{([]/g) || []).length;
            const closesAbove = (codeAbove.match(/[})\]]/g) || []).length;
            const closesInLine = (trimmed.match(/[})\]]/g) || []).length;

            // If already balanced above, this line is orphaned
            if (closesAbove >= opensAbove && closesInLine > 0) {
                lines.splice(i, 1);
                removedLines++;
                repaired = true;
            }
        }
    }

    if (removedLines > 0) {
        result = lines.join('\n');
        fixes.push(`Removed ${removedLines} orphaned trailing line(s)`);
    }

    return { repaired, code: result, fixes };
}

/**
 * Run all repair strategies on a code block.
 * Returns the repaired code and a log of all fixes applied.
 *
 * @param {string} code
 * @returns {{ repaired: boolean, code: string, fixes: string[] }}
 */
function autoRepair(code) {
    const allFixes = [];
    let current = code;
    let anyRepaired = false;

    // 1. Fix trailing orphans first (they confuse brace counting)
    const trailingResult = repairTrailingCode(current);
    if (trailingResult.repaired) {
        current = trailingResult.code;
        allFixes.push(...trailingResult.fixes);
        anyRepaired = true;
    }

    // 2. Fix braces
    const braceResult = repairBraces(current);
    if (braceResult.repaired) {
        current = braceResult.code;
        allFixes.push(...braceResult.fixes);
        anyRepaired = true;
    }

    // 3. Fix JSX tags
    const jsxResult = repairJsxTags(current);
    if (jsxResult.repaired) {
        current = jsxResult.code;
        allFixes.push(...jsxResult.fixes);
        anyRepaired = true;
    }

    return { repaired: anyRepaired, code: current, fixes: allFixes };
}

module.exports = {
    repairBraces,
    repairJsxTags,
    repairTrailingCode,
    autoRepair,
};
