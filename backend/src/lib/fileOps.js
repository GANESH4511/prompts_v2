/**
 * File Operations Utility
 * 
 * Shared helpers for filesystem checks, line-based diffing,
 * and oldCode→newCode patching used by the implement route.
 */

const fs = require('fs/promises');

/**
 * Check if a file exists at the given path.
 * @param {string} p - Absolute file path
 * @returns {Promise<boolean>}
 */
async function fileExists(p) {
    try { await fs.access(p); return true; } catch { return false; }
}

/**
 * Build a simple line-based diff between old and new code.
 * Each entry has { type: 'add'|'remove'|'unchanged', line, content }.
 *
 * @param {string} oldCode
 * @param {string} newCode
 * @returns {Array<{type: string, line: number, content: string}>}
 */
function buildDiff(oldCode, newCode) {
    const oldLines = oldCode.split('\n');
    const newLines = newCode.split('\n');
    const diff = [];
    const maxLen = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLen; i++) {
        const oldLine = i < oldLines.length ? oldLines[i] : undefined;
        const newLine = i < newLines.length ? newLines[i] : undefined;

        if (oldLine === undefined) {
            diff.push({ type: 'add', line: i + 1, content: newLine });
        } else if (newLine === undefined) {
            diff.push({ type: 'remove', line: i + 1, content: oldLine });
        } else if (oldLine !== newLine) {
            diff.push({ type: 'remove', line: i + 1, content: oldLine });
            diff.push({ type: 'add', line: i + 1, content: newLine });
        } else {
            diff.push({ type: 'unchanged', line: i + 1, content: oldLine });
        }
    }

    return diff;
}

/**
 * Apply oldCode→newCode replacement within a file's content.
 * If oldCode is found, replace it. Otherwise, return newCode as the full file.
 *
 * @param {string} fileContent - Current file content
 * @param {string} oldCode     - Fragment to find
 * @param {string} newCode     - Replacement fragment
 * @returns {string}
 */
function applyPatch(fileContent, oldCode, newCode) {
    if (!oldCode || !oldCode.trim()) {
        // Pure addition — append at end
        return fileContent + '\n' + newCode;
    }

    // Normalize line endings for matching
    const normalizedContent = fileContent.replace(/\r\n/g, '\n');
    const normalizedOld = oldCode.replace(/\r\n/g, '\n');

    if (normalizedContent.includes(normalizedOld)) {
        return normalizedContent.replace(normalizedOld, newCode.replace(/\r\n/g, '\n'));
    }

    // Fallback: try trimmed matching (handles whitespace differences)
    const trimmedOld = normalizedOld.trim();
    const lines = normalizedContent.split('\n');
    const oldLines = trimmedOld.split('\n');

    // Find the starting line
    for (let i = 0; i <= lines.length - oldLines.length; i++) {
        let match = true;
        for (let j = 0; j < oldLines.length; j++) {
            if (lines[i + j].trim() !== oldLines[j].trim()) {
                match = false;
                break;
            }
        }
        if (match) {
            const before = lines.slice(0, i).join('\n');
            const after = lines.slice(i + oldLines.length).join('\n');
            return before + (before ? '\n' : '') + newCode.replace(/\r\n/g, '\n') + (after ? '\n' + after : '');
        }
    }

    // Last resort: the LLM might have returned the full file as newCode
    console.warn('  ⚠️ Could not find oldCode in file — using newCode as full replacement');
    return newCode.replace(/\r\n/g, '\n');
}

/**
 * Parse SEARCH/REPLACE blocks from LLM output (implement v2 format).
 *
 * Expected format per block:
 *   <<<SEARCH>>>
 *   ...original lines...
 *   <<<REPLACE>>>
 *   ...replacement lines...
 *   <<<END>>>
 *
 * Also handles NEW_FILE blocks:
 *   <<<NEW_FILE: path/to/file.js>>>
 *   ...content...
 *   <<<END_FILE>>>
 *
 * @param {string} raw - Raw LLM output containing SEARCH/REPLACE blocks
 * @returns {{ patches: Array<{search: string, replace: string}>, newFiles: Array<{filePath: string, content: string}> }}
 */
function parseSearchReplaceBlocks(raw) {
    const normalized = raw.replace(/\r\n/g, '\n');
    const patches = [];
    const newFiles = [];

    // Parse SEARCH/REPLACE blocks
    const blockRegex = /<<<SEARCH>>>\n([\s\S]*?)<<<REPLACE>>>\n([\s\S]*?)<<<END>>>/g;
    let match;
    while ((match = blockRegex.exec(normalized)) !== null) {
        const search = match[1].replace(/\n$/, '');  // trim trailing newline
        const replace = match[2].replace(/\n$/, '');
        patches.push({ search, replace });
    }

    // Parse NEW_FILE blocks
    const newFileRegex = /<<<NEW_FILE:\s*(.+?)>>>\n([\s\S]*?)<<<END_FILE>>>/g;
    while ((match = newFileRegex.exec(normalized)) !== null) {
        const filePath = match[1].trim();
        const content = match[2].replace(/\n$/, '');
        newFiles.push({ filePath, content });
    }

    return { patches, newFiles };
}

/**
 * Apply an array of SEARCH/REPLACE patches to file content.
 * Each patch replaces the first occurrence of `search` with `replace`.
 *
 * Enhanced matching chain:
 *   1. Exact match
 *   2. Whitespace-tolerant (trim each line)
 *   3. Token-normalized (collapse all whitespace, compare tokens)
 *   4. Fuzzy (≥80% of lines match)
 *   5. Skip + log
 *
 * @param {string} fileContent - The current file content
 * @param {Array<{search: string, replace: string}>} patches
 * @returns {{ content: string, applied: number, skipped: number, warnings: string[] }}
 */
function applySearchReplacePatches(fileContent, patches) {
    let result = fileContent.replace(/\r\n/g, '\n');
    let applied = 0;
    let skipped = 0;
    const warnings = [];

    for (let pIdx = 0; pIdx < patches.length; pIdx++) {
        const patch = patches[pIdx];
        const normalizedSearch = patch.search.replace(/\r\n/g, '\n');
        const normalizedReplace = patch.replace.replace(/\r\n/g, '\n');

        // ── 1. Exact match ──
        if (result.includes(normalizedSearch)) {
            result = result.replace(normalizedSearch, normalizedReplace);
            applied++;
            continue;
        }

        // ── 2. Whitespace-tolerant match (trim each line) ──
        const searchLines = normalizedSearch.split('\n');
        const resultLines = result.split('\n');
        let found = false;

        for (let i = 0; i <= resultLines.length - searchLines.length; i++) {
            let match = true;
            for (let j = 0; j < searchLines.length; j++) {
                if (resultLines[i + j].trim() !== searchLines[j].trim()) {
                    match = false;
                    break;
                }
            }
            if (match) {
                const replaceLines = normalizedReplace.split('\n');
                resultLines.splice(i, searchLines.length, ...replaceLines);
                result = resultLines.join('\n');
                found = true;
                applied++;
                warnings.push(`Patch ${pIdx + 1}: applied via whitespace-tolerant match`);
                break;
            }
        }
        if (found) continue;

        // ── 3. Token-normalized match ──
        // Collapse all whitespace to single spaces and compare
        const tokenize = (s) => s.replace(/\s+/g, ' ').trim();
        const searchTokenized = tokenize(normalizedSearch);
        const resultLinesForToken = result.split('\n');

        for (let i = 0; i <= resultLinesForToken.length - searchLines.length; i++) {
            const candidateBlock = resultLinesForToken.slice(i, i + searchLines.length).join('\n');
            if (tokenize(candidateBlock) === searchTokenized) {
                const replaceLines = normalizedReplace.split('\n');
                resultLinesForToken.splice(i, searchLines.length, ...replaceLines);
                result = resultLinesForToken.join('\n');
                found = true;
                applied++;
                warnings.push(`Patch ${pIdx + 1}: applied via token-normalized match`);
                break;
            }
        }
        if (found) continue;

        // ── 4. Fuzzy match (≥80% of lines match) ──
        const FUZZY_THRESHOLD = 0.92;
        let bestScore = 0;
        let bestIndex = -1;

        for (let i = 0; i <= resultLinesForToken.length - searchLines.length; i++) {
            let matchCount = 0;
            for (let j = 0; j < searchLines.length; j++) {
                if (resultLinesForToken[i + j].trim() === searchLines[j].trim()) {
                    matchCount++;
                }
            }
            const score = matchCount / searchLines.length;
            if (score > bestScore) {
                bestScore = score;
                bestIndex = i;
            }
        }

        if (bestScore >= FUZZY_THRESHOLD && bestIndex >= 0) {
            const replaceLines = normalizedReplace.split('\n');
            const currentResultLines = result.split('\n');
            currentResultLines.splice(bestIndex, searchLines.length, ...replaceLines);
            result = currentResultLines.join('\n');
            applied++;
            warnings.push(`Patch ${pIdx + 1}: applied via fuzzy match (${Math.round(bestScore * 100)}% similarity)`);
            continue;
        }

        // ── 5. Skip — log details for debugging ──
        const preview = searchLines.slice(0, 3).map(l => l.trim()).join(' | ');
        console.warn(`  ⚠️ PATCH ${pIdx + 1} SKIPPED — SEARCH block not found (preview: "${preview.substring(0, 80)}")`);
        warnings.push(`Patch ${pIdx + 1}: SKIPPED — no match found`);
        skipped++;
    }

    return { content: result, applied, skipped, warnings };
}

/**
 * Parse full-file output from LLM (v3+ format).
 * Expected: <<<FULL_FILE>>> ... <<<END_FILE>>>
 */
function parseFullFileOutput(raw) {
    const normalized = raw.replace(/\r\n/g, '\n');
    const fullFileMatch = normalized.match(/<<<FULL_FILE>>>\n([\s\S]*?)<<<END_FILE>>>/);
    const content = fullFileMatch ? fullFileMatch[1].replace(/\n$/, '') : null;

    const newFiles = [];
    const newFileRegex = /<<<NEW_FILE:\s*(.+?)>>>\n([\s\S]*?)<<<END_FILE>>>/g;
    let match;
    while ((match = newFileRegex.exec(normalized)) !== null) {
        const filePath = match[1].trim();
        if (filePath) newFiles.push({ filePath, content: match[2].replace(/\n$/, '') });
    }

    return { content, newFiles };
}

module.exports = {
    fileExists, buildDiff, applyPatch,
    parseSearchReplaceBlocks, applySearchReplacePatches,
    parseFullFileOutput
};
