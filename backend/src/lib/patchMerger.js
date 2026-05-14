/**
 * patchMerger.js
 *
 * Merges SEARCH/REPLACE patches from multiple specialist agents into
 * a single coherent changeset.
 *
 * Handles:
 *   - Grouping patches by file
 *   - Conflict detection (overlapping SEARCH on same lines)
 *   - New file creation (<<<NEW_FILE>>> blocks)
 *   - Delete file actions (flagged as pendingDelete: true)
 *   - Ordering patches top-to-bottom for safe application
 */

const { rufloLog } = require('./rufloLogger');
const { validatePatch } = require('./syntaxValidator');

/**
 * Parse raw LLM output into structured patch objects.
 * Supports two formats:
 *   1. <<<SEARCH>>> / <<<REPLACE>>> / <<<END>>>
 *   2. <<<NEW_FILE: path>>> / <<<END_FILE>>>
 *
 * @param {string} rawOutput — the specialist agent's text output
 * @param {string} defaultFile — file path if not specified in patch
 * @returns {Array<{type, file, search, replace, fullContent}>}
 */
function parsePatchesFromOutput(rawOutput, defaultFile = '') {
    const patches = [];
    const lines = rawOutput.split('\n');
    let i = 0;

    while (i < lines.length) {
        const line = lines[i].trim();

        // New file block
        const newFileMatch = line.match(/^<<<NEW_FILE:\s*(.+?)>>>$/);
        if (newFileMatch) {
            const filePath = newFileMatch[1].trim();
            const contentLines = [];
            i++;
            while (i < lines.length && !lines[i].trim().startsWith('<<<END_FILE>>>')) {
                contentLines.push(lines[i]);
                i++;
            }
            patches.push({
                type: 'create',
                file: filePath,
                search: '',
                replace: '',
                fullContent: contentLines.join('\n'),
            });
            i++;
            continue;
        }

        // Search/Replace block
        if (line === '<<<SEARCH>>>') {
            const searchLines = [];
            i++;
            while (i < lines.length && !lines[i].trim().startsWith('<<<REPLACE>>>')) {
                searchLines.push(lines[i]);
                i++;
            }
            i++; // skip <<<REPLACE>>>
            const replaceLines = [];
            while (i < lines.length && !lines[i].trim().startsWith('<<<END>>>')) {
                replaceLines.push(lines[i]);
                i++;
            }
            patches.push({
                type: 'modify',
                file: defaultFile,
                search: searchLines.join('\n'),
                replace: replaceLines.join('\n'),
                fullContent: null,
            });
            i++;
            continue;
        }

        i++;
    }

    return patches;
}

/**
 * Find the line range where a SEARCH block matches in the source code.
 *
 * @param {string} sourceCode — full file content
 * @param {string} searchBlock — the text to find
 * @returns {{ startLine: number, endLine: number } | null}
 */
function findSearchLocation(sourceCode, searchBlock) {
    if (!searchBlock || !sourceCode) return null;

    const sourceLines = sourceCode.split('\n');
    const searchLines = searchBlock.split('\n').filter(l => l.trim() !== '');

    if (searchLines.length === 0) return null;

    const firstSearchLine = searchLines[0].trim();

    for (let i = 0; i < sourceLines.length; i++) {
        if (sourceLines[i].trim() === firstSearchLine) {
            // Check if all subsequent lines match
            let match = true;
            for (let j = 1; j < searchLines.length && i + j < sourceLines.length; j++) {
                if (sourceLines[i + j].trim() !== searchLines[j].trim()) {
                    match = false;
                    break;
                }
            }
            if (match) {
                return { startLine: i + 1, endLine: i + searchLines.length };
            }
        }
    }

    return null;
}

/**
 * Detect conflicts between patches targeting the same file.
 * Two patches conflict if their line ranges overlap.
 *
 * @param {Array} patches — patches with computed lineRange
 * @returns {Array<[number,number]>} pairs of conflicting patch indices
 */
function detectConflicts(patches) {
    const conflicts = [];
    for (let i = 0; i < patches.length; i++) {
        for (let j = i + 1; j < patches.length; j++) {
            if (patches[i].file !== patches[j].file) continue;
            if (patches[i].type === 'create' || patches[j].type === 'create') continue;
            if (!patches[i].lineRange || !patches[j].lineRange) continue;

            const a = patches[i].lineRange;
            const b = patches[j].lineRange;

            // Check overlap
            if (a.startLine <= b.endLine && b.startLine <= a.endLine) {
                conflicts.push([i, j]);
            }
        }
    }
    return conflicts;
}

/**
 * Merge patches from multiple agents into a single changeset.
 *
 * @param {Array<{agentId: string, output: string, file: string}>} agentOutputs
 * @param {string} sourceCode — original source for the primary file
 * @param {string} primaryFile — the main file path
 * @returns {{ patches: Array, conflicts: Array, fileGroups: Map }}
 */
function mergeAgentPatches(agentOutputs, sourceCode, primaryFile) {
    rufloLog('merge', `Merging patches from ${agentOutputs.length} agents`);

    const allPatches = [];

    // Parse patches from each agent
    for (const { agentId, output, file } of agentOutputs) {
        const parsed = parsePatchesFromOutput(output, file || primaryFile);
        let agentValid = 0;
        let agentInvalid = 0;
        for (const patch of parsed) {
            patch.agentId = agentId;
            // Validate each patch before including it
            if (patch.type === 'modify' && patch.search) {
                const result = validatePatch(patch, sourceCode);
                if (!result.valid) {
                    rufloLog('validation', `Agent ${agentId}: rejected patch — ${result.errors.join('; ')}`);
                    agentInvalid++;
                    continue; // skip this patch
                }
                patch.lineRange = findSearchLocation(sourceCode, patch.search);
            }
            allPatches.push(patch);
            agentValid++;
        }
        rufloLog('merge', `Agent ${agentId}: ${agentValid} valid, ${agentInvalid} rejected (of ${parsed.length})`);
    }

    // Group by file
    const fileGroups = new Map();
    for (const patch of allPatches) {
        const key = patch.file || primaryFile;
        if (!fileGroups.has(key)) fileGroups.set(key, []);
        fileGroups.get(key).push(patch);
    }

    // Sort patches within each file by line range (top to bottom)
    for (const [file, patches] of fileGroups) {
        patches.sort((a, b) => {
            if (!a.lineRange) return 1;
            if (!b.lineRange) return -1;
            return a.lineRange.startLine - b.lineRange.startLine;
        });
    }

    // Detect conflicts
    const conflicts = detectConflicts(allPatches);
    if (conflicts.length > 0) {
        rufloLog('error', `Detected ${conflicts.length} patch conflicts`, {
            pairs: conflicts.map(([i, j]) => `${allPatches[i].agentId}↔${allPatches[j].agentId}`).join(', ')
        });
    } else {
        rufloLog('merge', 'No conflicts detected');
    }

    return { patches: allPatches, conflicts, fileGroups };
}

/**
 * Build the final raw output string from merged patches.
 * This produces the same format that the existing implement pipeline expects.
 *
 * @param {Array} patches — merged and ordered patches
 * @returns {string} combined SEARCH/REPLACE output
 */
function buildMergedOutput(patches) {
    const parts = [];

    for (const patch of patches) {
        if (patch.type === 'create') {
            parts.push(`<<<NEW_FILE: ${patch.file}>>>`);
            parts.push(patch.fullContent);
            parts.push('<<<END_FILE>>>');
        } else if (patch.type === 'delete') {
            parts.push(`<<<DELETE_FILE: ${patch.file}>>>`);
        } else {
            parts.push('<<<SEARCH>>>');
            parts.push(patch.search);
            parts.push('<<<REPLACE>>>');
            parts.push(patch.replace);
            parts.push('<<<END>>>');
        }
        parts.push('');
    }

    return parts.join('\n');
}

module.exports = {
    parsePatchesFromOutput,
    findSearchLocation,
    detectConflicts,
    mergeAgentPatches,
    buildMergedOutput,
};
