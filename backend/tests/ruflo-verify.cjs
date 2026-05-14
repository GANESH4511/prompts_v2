/**
 * Verification test for all RuFlo pipeline modules.
 * Run: node --experimental-vm-modules backend/tests/ruflo-verify.cjs
 */

const { extractImportsExports, sliceAroundSection, buildSpecialistContext, compressPlan } = require('../src/lib/contextSlicer');
const { parsePatchesFromOutput, mergeAgentPatches, buildMergedOutput, findSearchLocation } = require('../src/lib/patchMerger');
const { rufloLog, sendUserStatus } = require('../src/lib/rufloLogger');
const { RufloClient } = require('../src/lib/rufloClient');

let passed = 0;
let failed = 0;

function test(name, condition) {
    if (condition) {
        console.log('  \u2705 ' + name);
        passed++;
    } else {
        console.log('  \u274c ' + name);
        failed++;
    }
}

console.log('\n=== RuFlo Pipeline Module Tests ===\n');

// --- contextSlicer.js ---
console.log('\ud83d\udce6 contextSlicer.js');

const src = [
    "import React from 'react'",
    "import { useState } from 'react'",
    "",
    "function App() {",
    "  return <div>Hello</div>",
    "}",
    "",
    "export default App"
].join('\n');

const extracted = extractImportsExports(src);
test('extractImportsExports - finds imports', extracted.imports.includes("import React"));
test('extractImportsExports - finds file exports', extracted.exports.includes("export default"));

const slice = sliceAroundSection(src, 4, 6, 1);
test('sliceAroundSection - includes target', slice.code.includes("function App"));
test('sliceAroundSection - has line metadata', slice.actualStart >= 1 && slice.actualEnd <= 8);

const plan = compressPlan({
    memory: 'test change',
    complexity: 'medium',
    plan: [
        { description: 'add button', action: 'add', location: 'App' },
        { description: 'add style', action: 'modify', location: 'styles' }
    ]
});
test('compressPlan - preserves task count', plan.tasks.length === 2);
test('compressPlan - preserves complexity', plan.complexity === 'medium');

const specialistCtx = buildSpecialistContext(src, plan.tasks[0], plan);
test('buildSpecialistContext - includes task desc', specialistCtx.includes('add button'));
test('buildSpecialistContext - includes source', specialistCtx.includes('function App'));

// --- patchMerger.js ---
console.log('\n\ud83d\udd00 patchMerger.js');

const rawPatch = [
    '<<<SEARCH>>>',
    'function App() {',
    '<<<REPLACE>>>',
    'function App({ name }) {',
    '<<<END>>>'
].join('\n');

const patches = parsePatchesFromOutput(rawPatch, 'test.tsx');
test('parsePatchesFromOutput - parses 1 patch', patches.length === 1);
test('parsePatchesFromOutput - correct search', patches[0].search.includes('function App'));
test('parsePatchesFromOutput - correct replace', patches[0].replace.includes('{ name }'));
test('parsePatchesFromOutput - correct type', patches[0].type === 'modify');

const newFileRaw = [
    '<<<NEW_FILE: src/utils/helper.js>>>',
    'const helper = () => true;',
    'module.exports = helper;',
    '<<<END_FILE>>>'
].join('\n');

const newPatches = parsePatchesFromOutput(newFileRaw);
test('NEW_FILE - type=create', newPatches[0].type === 'create');
test('NEW_FILE - correct path', newPatches[0].file === 'src/utils/helper.js');
test('NEW_FILE - has content', newPatches[0].fullContent.includes('helper'));

const loc = findSearchLocation(src, 'function App() {');
test('findSearchLocation - correct line', loc && loc.startLine === 4);

const loc2 = findSearchLocation(src, 'export default App');
test('findSearchLocation - export line', loc2 && loc2.startLine === 8);

const locNull = findSearchLocation(src, 'this does not exist');
test('findSearchLocation - null on miss', locNull === null);

const agents = [
    { agentId: 'ui-agent', output: rawPatch, file: 'test.tsx' },
    { agentId: 'export-agent', output: '<<<SEARCH>>>\nexport default App\n<<<REPLACE>>>\nexport default React.memo(App)\n<<<END>>>', file: 'test.tsx' }
];

const merged = mergeAgentPatches(agents, src, 'test.tsx');
test('mergeAgentPatches - merges 2 patches', merged.patches.length === 2);
test('mergeAgentPatches - no conflicts', merged.conflicts.length === 0);

const output = buildMergedOutput(merged.patches);
test('buildMergedOutput - valid format', output.includes('<<<SEARCH>>>') && output.includes('<<<REPLACE>>>'));
test('buildMergedOutput - both patches', output.split('<<<SEARCH>>>').length === 3);

// --- rufloLogger.js ---
console.log('\n\ud83d\udcdd rufloLogger.js');

rufloLog('pipeline', 'test message', { key: 'value' });
test('rufloLog - no crash with data', true);

rufloLog('architect', 'plan complete');
test('rufloLog - no crash without data', true);

let captured = null;
sendUserStatus((type, data) => { captured = { type, data }; }, 'architect_start');
test('sendUserStatus - architect_start', captured && captured.data.message === 'Analyzing your change request...');

captured = null;
sendUserStatus((type, data) => { captured = { type, data }; }, 'agents_spawning', 3);
test('sendUserStatus - agents_spawning(3)', captured && captured.data.message === 'Working on 3 modifications...');

captured = null;
sendUserStatus((type, data) => { captured = { type, data }; }, 'merge_done');
test('sendUserStatus - merge_done', captured && captured.data.message === 'Changes ready for review.');

// --- rufloClient.js ---
console.log('\n\ud83d\udce1 rufloClient.js');

const client = new RufloClient('http://localhost:9999');
test('RufloClient - instantiates', client.baseUrl === 'http://localhost:9999');

client.isAvailable().then(available => {
    test('RufloClient.isAvailable - false when offline', available === false);

    console.log('\n' + '='.repeat(40));
    console.log('  RESULTS: ' + passed + ' passed, ' + failed + ' failed');
    console.log('='.repeat(40) + '\n');
    process.exit(failed > 0 ? 1 : 0);
});
