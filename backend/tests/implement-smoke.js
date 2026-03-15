/**
 * Smoke test for the two-pass implement architecture.
 * Verifies templates load correctly and JSON parsing handles the new format.
 * 
 * Run: node backend/tests/implement-smoke.js
 */

const path = require('path');

// Resolve project root
const projectRoot = path.resolve(__dirname, '..');
process.chdir(projectRoot);

const { loadTemplate, getLatestVersion } = require('../src/llm');
const { parseWithRepair } = require('../src/lib/jsonRepair');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (e) {
        console.error(`  ❌ ${name}: ${e.message}`);
        failed++;
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

console.log('\n🧪 Implement Feature Smoke Tests\n');

// ─── Template Loading ───

test('implement-plan template loads', () => {
    const version = getLatestVersion('implement-plan');
    assert(version, 'No version found for implement-plan');
    const template = loadTemplate('implement-plan', version);
    assert(template, 'Template is null');
    assert(template.content, 'Template has no content');
    assert(template.content.includes('Change Planner'), 'Template missing expected content');
});

test('implement template loads', () => {
    const version = getLatestVersion('implement');
    assert(version, 'No version found for implement');
    const template = loadTemplate('implement', version);
    assert(template, 'Template is null');
    assert(template.content, 'Template has no content');
    assert(template.content.includes('fullCode'), 'Template missing fullCode instruction');
});

// ─── JSON Parsing: New fullCode format ───

test('parses fullCode JSON response', () => {
    const raw = JSON.stringify({
        fullCode: 'const x = 1;\nconsole.log(x);'
    });
    const parsed = parseWithRepair(raw);
    assert(parsed.fullCode === 'const x = 1;\nconsole.log(x);', 'fullCode mismatch');
});

test('parses fullCode with markdown fences', () => {
    const raw = '```json\n{"fullCode": "const x = 1;"}\n```';
    const parsed = parseWithRepair(raw);
    assert(parsed.fullCode === 'const x = 1;', 'fullCode mismatch after fence removal');
});

test('parses plan JSON response', () => {
    const raw = JSON.stringify({
        memory: 'This file handles routing',
        plan: [
            { location: 'handleSubmit function', action: 'modify', description: 'Add validation' }
        ],
        suggestedFiles: [],
        newFiles: []
    });
    const parsed = parseWithRepair(raw);
    assert(parsed.memory === 'This file handles routing', 'memory mismatch');
    assert(Array.isArray(parsed.plan), 'plan is not an array');
    assert(parsed.plan.length === 1, 'plan should have 1 entry');
    assert(parsed.plan[0].action === 'modify', 'plan action mismatch');
});

// ─── JSON Parsing: Legacy format (backward compat) ───

test('parses legacy changes format', () => {
    const raw = JSON.stringify({
        memory: 'test',
        changes: [
            { oldCode: 'const x = 1;', newCode: 'const x = 2;', description: 'Bump' }
        ]
    });
    const parsed = parseWithRepair(raw);
    assert(Array.isArray(parsed.changes), 'changes is not an array');
    assert(parsed.changes[0].oldCode === 'const x = 1;', 'oldCode mismatch');
});

// ─── Summary ───

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
