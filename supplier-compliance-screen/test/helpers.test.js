import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRisk, cleanCompany, escapeOpenFda } from '../src/helpers.js';

test('normalizes company whitespace and ignores non-string input', () => {
    assert.equal(cleanCompany('  Blue   Bell Creameries  '), 'Blue Bell Creameries');
    assert.equal(cleanCompany(null), '');
});

test('escapes OpenFDA search syntax characters', () => {
    assert.equal(escapeOpenFda('A "B" (C)'), 'A \\"B\\" \\(C\\)');
});

test('risk score is bounded and cites contributing record classes', () => {
    const result = calculateRisk([{ recall_number: 'R1' }], [
        { quarters_in_noncompliance: '2', formal_actions: '1' },
    ]);
    assert.equal(result.score, 38);
    assert.equal(result.basis.length, 3);
    assert.ok(result.score >= 0 && result.score <= 100);
});

test('empty source results produce a zero score with an explicit basis', () => {
    const result = calculateRisk([], []);
    assert.equal(result.score, 0);
    assert.match(result.basis[0], /No matching/);
});
