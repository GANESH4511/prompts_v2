/**
 * Verification test for all RuFlo pipeline modules.
 * Run: node backend/tests/ruflo-verify.js
 */

const { extractImportsExports, sliceAroundSection, buildSpecialistContext, compressPlan } = require('../src/lib/contextSlicer');
const { parsePatchesFromOutput, mergeAgentPatches, buildMergedOutput, findSearchLocation } = require('../src/lib/patchMerger');
const { rufloLog, sendUserStatus } = require('../src/lib/rufloLogger');
const { RufloClient } = require('../src/lib/rufloClient');

let passed = 0;
let failed = 0;

function test(name, condition) {
    if (condition) {
        console.log(`  ✅ ${name}`);
        passed++;
    } else {
        console.log(`  ❌ ${name}`);
        failed++;
    }
}

console.log('\n=== RuFlo Pipeline Module Tests ===\n');

// --- contextSlicer.js ---
console.log('📦 contextSlicer.js');

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

const { imports, exports } = extractImportsExports(src);
test('extractImportsExports — finds imports', imports.includes("import React"));
test('extractImportsExports — finds exports', exports.includes("export default"));

const slice = sliceAroundSection(src, 4, 6, 1);
test('sliceAroundSection — includes target', slice.code.includes("function App"));
test('sliceAroundSection — has line metadata', slice.actualStart >= 1 && slice.actualEnd <= 8);

const plan = compressPlan({
    memory: 'test change',
    complexity: 'medium',
    plan: [
        { description: 'add button', action: 'add', location: 'App' },
        { description: 'add style', action: 'modify', location: 'styles' }
    ]
});
test('compressPlan — preserves task count', plan.tasks.length === 2);
test('compressPlan — preserves complexity', plan.complexity === 'medium');

const specialistCtx = buildSpecialistContext(src, plan.tasks[0], plan);
test('buildSpecialistContext — includes task description', specialistCtx.includes('add button'));
test('buildSpecialistContext — includes source code', specialistCtx.includes('function App'));

// --- patchMerger.js ---
console.log('\n🔀 patchMerger.js');

const rawPatch = [
    '<<<SEARCH>>>',
    'function App() {',
    '<<<REPLACE>>>',
    'function App({ name }) {',
    '<<<END>>>'
].join('\n');

const patches = parsePatchesFromOutput(rawPatch, 'test.tsx');
test('parsePatchesFromOutput — parses 1 patch', patches.length === 1);
test('parsePatchesFromOutput — correct search', patches[0].search.includes('function App'));
test('parsePatchesFromOutput — correct replace', patches[0].replace.includes('{ name }'));
test('parsePatchesFromOutput — correct type', patches[0].type === 'modify');

const newFileRaw = [
    '<<<NEW_FILE: src/utils/helper.js>>>',
    'const helper = () => true;',
    'module.exports = helper;',
    '<<<END_FILE>>>'
].join('\n');

const newPatches = parsePatchesFromOutput(newFileRaw);
test('parsePatchesFromOutput — NEW_FILE type=create', newPatches[0].type === 'create');
test('parsePatchesFromOutput — NEW_FILE path', newPatches[0].file === 'src/utils/helper.js');
test('parsePatchesFromOutput — NEW_FILE content', newPatches[0].fullContent.includes('helper'));

const loc = findSearchLocation(src, 'function App() {');
test('findSearchLocation — correct line', loc && loc.startLine === 4);

const loc2 = findSearchLocation(src, 'export default App');
test('findSearchLocation — export line', loc2 && loc2.startLine === 8);

const locNull = findSearchLocation(src, 'this does not exist');
test('findSearchLocation — returns null on miss', locNull === null);

const agents = [
    { agentId: 'ui-agent', output: rawPatch, file: 'test.tsx' },
    { agentId: 'export-agent', output: '<<<SEARCH>>>\nexport default App\n<<<REPLACE>>>\nexport default React.memo(App)\n<<<END>>>', file: 'test.tsx' }
];

const merged = mergeAgentPatches(agents, src, 'test.tsx');
test('mergeAgentPatches — merges 2 patches', merged.patches.length === 2);
test('mergeAgentPatches — no conflicts', merged.conflicts.length === 0);

const output = buildMergedOutput(merged.patches);
test('buildMergedOutput — valid output', output.includes('<<<SEARCH>>>') && output.includes('<<<REPLACE>>>'));
test('buildMergedOutput — contains both patches', output.split('<<<SEARCH>>>').length === 3);

// --- rufloLogger.js ---
console.log('\n📝 rufloLogger.js');

rufloLog('pipeline', 'test message', { key: 'value' });
test('rufloLog — no crash', true);

rufloLog('architect', 'plan complete');
test('rufloLog — no data arg', true);

let captured = null;
sendUserStatus((type, data) => { captured = { type, data }; }, 'architect_start');
test('sendUserStatus — architect_start', captured && captured.data.message === 'Analyzing your change request...');

captured = null;
sendUserStatus((type, data) => { captured = { type, data }; }, 'agents_spawning', 3);
test('sendUserStatus — agents_spawning(3)', captured && captured.data.message === 'Working on 3 modifications...');

captured = null;
sendUserStatus((type, data) => { captured = { type, data }; }, 'merge_done');
test('sendUserStatus — merge_done', captured && captured.data.message === 'Changes ready for review.');

// --- rufloClient.js ---
console.log('\n📡 rufloClient.js');

const client = new RufloClient('http://localhost:9999');
test('RufloClient — instantiates', client.baseUrl === 'http://localhost:9999');

// Health check should fail gracefully (no server running on 9999)
client.isAvailable().then(available => {
    test('RufloClient.isAvailable — returns false when offline', available === false);

    // --- Summary ---
    console.log(`\n${'='.repeat(40)}`);
    console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
    console.log(`${'='.repeat(40)}\n`);
    process.exit(failed > 0 ? 1 : 0);
});
