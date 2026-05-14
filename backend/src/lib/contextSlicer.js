/**
 * contextSlicer.js
 *
 * Token optimization for multi-agent pipeline.
 * Architect gets full context; specialist agents get only their relevant slice.
 *
 * Estimated savings: 60-70% fewer tokens per specialist vs sending full source.
 */

const { rufloLog } = require('./rufloLogger');
const fs = require('fs');
const path = require('path');

// Load frontend excellence rules (from 15 skills) — cached at startup
let frontendRulesCache = null;
function getFrontendRules() {
    if (frontendRulesCache) return frontendRulesCache;
    try {
        const rulesPath = path.resolve(__dirname, '../../templates/frontend-rules.txt');
        frontendRulesCache = fs.readFileSync(rulesPath, 'utf-8');
        return frontendRulesCache;
    } catch (e) {
        rufloLog('warning', `Could not load frontend-rules.txt: ${e.message}`);
        return '';
    }
}

/**
 * Extract the import/export header from source code.
 * Returns the first N lines that are imports/requires + the last lines that are exports.
 */
function extractImportsExports(sourceCode) {
    const lines = sourceCode.split('\n');
    const importLines = [];
    const exportLines = [];
    
    // Collect imports from the top
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (
            line.startsWith('import ') ||
            line.startsWith("import{") ||
            line.startsWith("import {") ||
            line.startsWith('const ') && line.includes('require(') ||
            line.startsWith("'use ") ||
            line.startsWith('"use ') ||
            line === '' ||
            line.startsWith('//') ||
            line.startsWith('/*') ||
            line.startsWith(' *') ||
            line.startsWith(' */') ||
            line.startsWith('from ') ||
            line.startsWith('} from ')
        ) {
            importLines.push(lines[i]);
        } else {
            break;
        }
    }

    // Collect exports from the bottom (last 10 lines max)
    const tail = lines.slice(-10);
    for (let i = 0; i < tail.length; i++) {
        const line = tail[i].trim();
        if (
            line.startsWith('export ') ||
            line.startsWith('module.exports') ||
            line === '' ||
            line === '}' ||
            line === '};'
        ) {
            exportLines.push(tail[i]);
        }
    }

    return {
        imports: importLines.join('\n'),
        exports: exportLines.join('\n'),
        importLineCount: importLines.length,
    };
}

/**
 * Slice source code to ±windowSize lines around a target line range.
 *
 * @param {string} sourceCode — full source
 * @param {number} startLine  — 1-indexed start of target section
 * @param {number} endLine    — 1-indexed end of target section
 * @param {number} windowSize — number of extra lines above/below (default 20)
 * @returns {string} sliced source with line markers
 */
function sliceAroundSection(sourceCode, startLine, endLine, windowSize = 40) {
    const lines = sourceCode.split('\n');
    const sliceStart = Math.max(0, startLine - 1 - windowSize);
    const sliceEnd = Math.min(lines.length, endLine + windowSize);
    const sliced = lines.slice(sliceStart, sliceEnd);

    return {
        code: sliced.join('\n'),
        actualStart: sliceStart + 1,
        actualEnd: sliceEnd,
        totalLines: lines.length,
    };
}

/**
 * Find the enclosing function/class/component scope for a given line.
 * Walks upward from the target line to find the nearest function, const arrow,
 * class, or component boundary. This ensures the specialist sees the complete
 * function they're modifying, preventing partial-body patches.
 *
 * @param {string} sourceCode — full source file
 * @param {number} targetLine — 1-indexed line number to find scope for
 * @returns {{ startLine: number, endLine: number } | null}
 */
function findEnclosingScope(sourceCode, targetLine) {
    const lines = sourceCode.split('\n');
    const idx = targetLine - 1; // 0-indexed

    if (idx < 0 || idx >= lines.length) return null;

    // Patterns that start a function/class/component scope
    const scopePatterns = [
        /^\s*(export\s+)?(default\s+)?function\s/,
        /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(.*\)\s*=>\s*\{?/,
        /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?function/,
        /^\s*(export\s+)?(default\s+)?class\s/,
        /^\s*(export\s+)?(const|let|var)\s+\w+:\s*React\.FC/,
    ];

    // Walk upward to find scope start
    let scopeStart = -1;
    for (let i = idx; i >= 0; i--) {
        const line = lines[i];
        for (const pattern of scopePatterns) {
            if (pattern.test(line)) {
                scopeStart = i;
                break;
            }
        }
        if (scopeStart >= 0) break;
    }

    if (scopeStart < 0) return null;

    // Walk downward from scope start to find matching closing brace
    let braceCount = 0;
    let foundOpen = false;
    let scopeEnd = scopeStart;

    for (let i = scopeStart; i < lines.length; i++) {
        const line = lines[i];
        for (const ch of line) {
            if (ch === '{') { braceCount++; foundOpen = true; }
            if (ch === '}') braceCount--;
        }
        if (foundOpen && braceCount <= 0) {
            scopeEnd = i;
            break;
        }
    }

    return {
        startLine: scopeStart + 1, // 1-indexed
        endLine: scopeEnd + 1,
    };
}

/**
 * Build full context for the architect agent.
 *
 * @param {string} sourceCode    — full source file content
 * @param {string} pageContext   — NLP context from buildPageContext()
 * @param {string} changeRequest — the user's change request text
 * @param {object} pageData      — Prisma page data (sections, stateVars, functions)
 * @returns {string} formatted context string
 */
function buildArchitectContext(sourceCode, pageContext, changeRequest, pageData = {}) {
    const lines = sourceCode.split('\n');
    const tokenEstimate = Math.ceil(sourceCode.length / 4);
    
    rufloLog('context', 'Building architect context', { 
        sourceLines: lines.length, 
        estimatedTokens: tokenEstimate 
    });

    const parts = [];

    parts.push(`=== CHANGE REQUEST ===\n${changeRequest}`);
    
    if (pageContext) {
        parts.push(`\n${pageContext}`);
    }

    // File structure summary
    if (pageData.filePath) {
        parts.push(`\n=== FILE INFO ===\nFile: ${pageData.filePath}\nComponent: ${pageData.componentName || 'unknown'}\nTotal Lines: ${lines.length}`);
    }

    // State variables summary
    if (pageData.stateVars && pageData.stateVars.length > 0) {
        const stateList = pageData.stateVars
            .map(s => `  - ${s.name} (line ${s.line}): ${s.type || 'unknown'}`)
            .join('\n');
        parts.push(`\n=== STATE VARIABLES ===\n${stateList}`);
    }

    // Functions summary
    if (pageData.functions && pageData.functions.length > 0) {
        const funcList = pageData.functions
            .map(f => `  - ${f.name} (lines ${f.startLine}-${f.endLine}): ${f.purpose || ''}`)
            .join('\n');
        parts.push(`\n=== FUNCTIONS ===\n${funcList}`);
    }

    // Sections summary
    if (pageData.sections && pageData.sections.length > 0) {
        const secList = pageData.sections
            .map(s => `  - "${s.name}" (lines ${s.startLine}-${s.endLine}): ${s.purpose}`)
            .join('\n');
        parts.push(`\n=== SECTIONS ===\n${secList}`);
    }

    // Full source code
    parts.push(`\n=== SOURCE CODE ===\n${sourceCode}`);

    const fullContext = parts.join('\n');
    rufloLog('token', 'Architect context built', { chars: fullContext.length, estimatedTokens: Math.ceil(fullContext.length / 4) });

    return fullContext;
}

/**
 * Build minimal context for a specialist agent.
 * Only includes the code section they need to modify + imports + their specific task.
 *
 * @param {string} sourceCode — full source file content
 * @param {object} task       — from architect plan: { file, section, startLine, endLine, changeType, description }
 * @param {object} plan       — compressed architect plan (for awareness of other changes)
 * @returns {string} minimal context string
 */
function buildSpecialistContext(sourceCode, task, plan = {}) {
    const parts = [];

    // Their specific task
    parts.push(`=== YOUR TASK ===\nFile: ${task.file || 'current file'}\nAction: ${task.changeType || task.action || 'modify'}\nDescription: ${task.description}`);

    // Awareness of other tasks (compressed)
    if (plan.tasks && plan.tasks.length > 1) {
        const otherTasks = plan.tasks
            .filter(t => t.description !== task.description)
            .map(t => `  - ${t.action}: ${t.description}`)
            .join('\n');
        if (otherTasks) {
            parts.push(`\n=== OTHER CHANGES (for awareness, do NOT implement these) ===\n${otherTasks}`);
        }
    }

    // Imports/exports header
    const { imports, exports } = extractImportsExports(sourceCode);
    if (imports) {
        parts.push(`\n=== IMPORTS (file header) ===\n${imports}`);
    }

    // Sliced code around target section
    if (task.startLine && task.endLine) {
        // Try scope-aware slicing: expand to include the full enclosing function
        const scope = findEnclosingScope(sourceCode, task.startLine);
        const sliceStart = scope ? Math.min(scope.startLine, task.startLine) : task.startLine;
        const sliceEnd = scope ? Math.max(scope.endLine, task.endLine) : task.endLine;
        const slice = sliceAroundSection(sourceCode, sliceStart, sliceEnd);
        parts.push(`\n=== SOURCE CODE (lines ${slice.actualStart}-${slice.actualEnd} of ${slice.totalLines}) ===\n${slice.code}`);
    } else if (task.location) {
        // Try to find the location in source by searching for the text
        const lines = sourceCode.split('\n');
        const idx = lines.findIndex(l => l.includes(task.location));
        if (idx >= 0) {
            // Use scope detection to give the specialist the complete function
            const scope = findEnclosingScope(sourceCode, idx + 1);
            const sliceStart = scope ? scope.startLine : idx + 1;
            const sliceEnd = scope ? scope.endLine : idx + 1;
            const slice = sliceAroundSection(sourceCode, sliceStart, sliceEnd);
            parts.push(`\n=== SOURCE CODE (lines ${slice.actualStart}-${slice.actualEnd} of ${slice.totalLines}) ===\n${slice.code}`);
        } else {
            // Can't find location, send more context
            parts.push(`\n=== SOURCE CODE (full) ===\n${sourceCode}`);
        }
    } else {
        // New file or unknown location — send full source for awareness
        parts.push(`\n=== SOURCE CODE (full) ===\n${sourceCode}`);
    }

    if (exports) {
        parts.push(`\n=== EXPORTS (file footer) ===\n${exports}`);
    }

    // Auto-inject frontend excellence rules for frontend files
    const filePath = task.file || '';
    const ext = (filePath.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    if (['.tsx', '.jsx', '.css', '.scss'].includes(ext)) {
        const frontendRules = getFrontendRules();
        if (frontendRules) {
            parts.push(`\n${frontendRules}`);
            rufloLog('context', `Injected frontend excellence rules for ${ext} file`);
        }
    }

    const fullContext = parts.join('\n');
    rufloLog('token', 'Specialist context built', { 
        task: task.description?.substring(0, 50), 
        chars: fullContext.length, 
        estimatedTokens: Math.ceil(fullContext.length / 4) 
    });

    return fullContext;
}

/**
 * Compress the architect's plan to minimal structured JSON.
 * Removes prose, keeps only actionable items.
 *
 * @param {object} architectOutput — raw architect JSON output
 * @returns {object} compressed plan
 */
function compressPlan(architectOutput) {
    return {
        memory: architectOutput.memory || '',
        complexity: architectOutput.complexity || 'medium',
        tasks: (architectOutput.plan || []).map(p => ({
            file: p.file || p.location || 'current file',
            action: p.action || 'modify',
            description: p.description,
            startLine: p.startLine,
            endLine: p.endLine,
            location: p.location,
        })),
        newFiles: architectOutput.newFiles || [],
        deleteFiles: architectOutput.deleteFiles || [],
    };
}

module.exports = {
    extractImportsExports,
    sliceAroundSection,
    findEnclosingScope,
    buildArchitectContext,
    buildSpecialistContext,
    compressPlan,
};
