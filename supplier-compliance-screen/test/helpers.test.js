import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFdaSearchUrl, calculateRisk, cleanCompany, escapeOpenFda, matchesEpaFacility, normalizeInput, reportActorFailure, uniqueCompanies } from '../src/helpers.js';

test('normalizes company whitespace and ignores non-string input', () => {
    assert.equal(cleanCompany('  Blue   Bell Creameries  '), 'Blue Bell Creameries');
    assert.equal(cleanCompany(null), '');
});

test('escapes OpenFDA search syntax characters', () => {
    assert.equal(escapeOpenFda('A "B" (C)'), 'A \\"B\\" \\(C\\)');
});

test('FDA query bounds results to the lookback period and sorts newest first', () => {
    const url = buildFdaSearchUrl('drug', 'Pfizer', 3, 5, new Date('2026-10-09T12:00:00Z'));
    assert.equal(url.searchParams.get('search'), 'recalling_firm:"Pfizer" AND report_date:[20231009 TO 20261009]');
    assert.equal(url.searchParams.get('sort'), 'report_date:desc');
    assert.equal(url.searchParams.get('limit'), '5');
});

test('EPA match requires every distinctive company-name token', () => {
    assert.equal(matchesEpaFacility('Pfizer Inc.', 'Pfizer Manufacturing Company'), true);
    assert.equal(matchesEpaFacility('Pfizer', 'ACP BK I LLC - 630 FLUSHING AVE'), false);
    assert.equal(matchesEpaFacility('Kraft Heinz', 'Kraft Heinz Foods Company'), true);
});

test('company deduplication ignores case and repeated whitespace', () => {
    assert.deepEqual(uniqueCompanies(['Tyson Foods', ' tyson  foods ', 'Acme']), ['Tyson Foods', 'Acme']);
});

test('company states stay aligned to the first original occurrence after deduplication', () => {
    const result = normalizeInput({
        companies: ['Tyson Foods', 'tyson foods', 'Pfizer'],
        companyStates: ['IA', 'MN', 'NY'],
    });
    assert.deepEqual(result.companies, ['Tyson Foods', 'Pfizer']);
    assert.deepEqual(result.companyStates, ['IA', 'NY']);
});

test('invalid company count and lookback are rejected during input validation', () => {
    assert.throws(() => normalizeInput({ companies: ['A', 'B', 'C', 'D'] }), /between 1 and 3/);
    assert.throws(() => normalizeInput({ companies: ['Pfizer'], lookbackYears: 0 }), /lookbackYears/);
});

test('actor validation failures are logged before failing the run', async () => {
    const events = [];
    const actor = { fail: async (message) => events.push(['fail', message]) };
    const logger = { error: (message) => events.push(['error', message]) };

    await reportActorFailure(actor, new Error('lookbackYears must be an integer from 1 to 10.'), logger);

    assert.deepEqual(events, [
        ['error', 'lookbackYears must be an integer from 1 to 10.'],
        ['fail', 'lookbackYears must be an integer from 1 to 10.'],
    ]);
});

test('companyStates must align with original input companies', () => {
    assert.throws(() => normalizeInput({
        companies: ['Tyson Foods', 'tyson foods', 'Pfizer'],
        companyStates: ['IA', 'NY'],
    }), /one state for each input company/);
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
