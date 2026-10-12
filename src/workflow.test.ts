import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryError, runWorkflow } from './workflow.js';
import type { Ports } from './workflow.js';
import type { ProductAnalysis } from './types.js';
import { importInput, QA_NEXT, QA_NOW, QA_OBSERVATION, QA_PEER } from './test-fixtures.js';

function memoryPorts(overrides: Partial<Ports> = {}) {
    const saved: ProductAnalysis[] = [], files = new Map<string, unknown>();
    let checks = 0;
    const ports: Ports = {
        canSave: () => { checks += 1; return true; },
        save: async (record) => { saved.push(record); return { chargedCount: 1, eventChargeLimitReached: false }; },
        write: async (key, value) => { files.set(key, value); }, status: async () => undefined, ...overrides,
    };
    return { ports, saved, files, get checks() { return checks; } };
}
test('full import saves and charges once per product, writes flat reports and no persistent history', async () => {
    const memory = memoryPorts();
    const summary = await runWorkflow(importInput([QA_OBSERVATION, QA_NEXT, QA_PEER]), memory.ports, QA_NOW);
    assert.equal(memory.saved.length, 2); assert.equal(summary.savedObservationCount, 3);
    assert.equal(summary.productResultEventCount, 2); assert.equal(summary.outcome, 'succeeded');
    assert.equal(summary.persistentHistoryWritten, false); assert.equal(summary.upstreamRequestCount, 0);
    assert.deepEqual([...memory.files.keys()], ['REPORT', 'COMPARISON.csv', 'FINDINGS.csv', 'QUALITY.csv', 'REPORT.md', 'RUN_STATUS']);
    assert((memory.saved[0] as unknown as Record<string, unknown>).singleProductAnalysis);
});
test('an exact final-row budget cap is a complete delivery, not a false failure', async () => {
    const memory = memoryPorts({ save: async () => ({ chargedCount: 1, eventChargeLimitReached: true }) });
    const summary = await runWorkflow(importInput(), memory.ports, QA_NOW);
    assert.equal(summary.outcome, 'succeeded'); assert.equal(summary.completeSelectedOutput, true);
    assert.equal(summary.spendingLimitReached, true); assert.equal(summary.savedProductCount, 1);
});
test('a real partial budget cap is clearly partial and never exports unbilled product data', async () => {
    const memory = memoryPorts({ save: async () => ({ chargedCount: 1, eventChargeLimitReached: true }) });
    const summary = await runWorkflow(importInput([QA_OBSERVATION, QA_PEER]), memory.ports, QA_NOW);
    assert.equal(summary.outcome, 'stopped_spending_limit'); assert.equal(summary.completeSelectedOutput, false);
    assert.equal(summary.unsavedSelectedProductCount, 1); assert(!String(memory.files.get('COMPARISON.csv')).includes('00000002'));
});
test('zero budget stops before any result save or report disclosure', async () => {
    const memory = memoryPorts({ canSave: () => false });
    const summary = await runWorkflow(importInput(), memory.ports, QA_NOW);
    assert.equal(memory.saved.length, 0); assert.equal(summary.savedProductCount, 0);
    assert.equal(summary.outcome, 'stopped_spending_limit'); assert(!String(memory.files.get('COMPARISON.csv')).includes('00000001'));
});
test('SDK zero-charged limit acknowledgment is not mistaken for a saved product', async () => {
    const memory = memoryPorts({ save: async () => ({ chargedCount: 0, eventChargeLimitReached: true }) });
    const summary = await runWorkflow(importInput(), memory.ports, QA_NOW);
    assert.equal(summary.savedProductCount, 0); assert.equal(summary.productResultEventCount, 0); assert.equal(summary.completeSelectedOutput, false);
});
test('local unmonetized SDK acknowledgment supports saved output without fictitious charge counts', async () => {
    const memory = memoryPorts({ save: async () => ({ chargedCount: 0, eventChargeLimitReached: false }) });
    const summary = await runWorkflow(importInput(), memory.ports, QA_NOW);
    assert.equal(summary.savedProductCount, 1); assert.equal(summary.productResultEventCount, 0);
});
test('dataset/billing exceptions never leak credential values or retry an uncertain save', async () => {
    let calls = 0;
    const memory = memoryPorts({ save: async () => { calls += 1; throw new Error('password=TOP-SECRET bearer-token'); } });
    await assert.rejects(runWorkflow(importInput([QA_OBSERVATION, QA_PEER]), memory.ports, QA_NOW), (error) => {
        assert(error instanceof DeliveryError); assert(!error.message.includes('TOP-SECRET')); return true;
    });
    assert.equal(calls, 1); assert.equal((memory.files.get('RUN_STATUS') as Record<string, unknown>).outcome, 'failed_delivery');
    assert.equal((memory.files.get('RUN_STATUS') as Record<string, unknown>).unconfirmedDeliveryAttempt, true);
    assert(String((memory.files.get('RUN_STATUS') as Record<string, unknown>).unconfirmedDeliveryNotice).includes('may already have persisted and billed'));
    assert(!JSON.stringify([...memory.files.values()]).includes('TOP-SECRET'));
});
test('an unrecognized save acknowledgment is a delivery failure, not free completed output', async () => {
    const memory = memoryPorts({ save: async () => ({ chargedCount: 2, eventChargeLimitReached: false }) });
    await assert.rejects(runWorkflow(importInput(), memory.ports, QA_NOW), DeliveryError);
    assert.equal((memory.files.get('RUN_STATUS') as Record<string, unknown>).savedProductCount, 0);
});
test('report write failure is reported and does not trigger extra product saves', async () => {
    let calls = 0;
    const memory = memoryPorts({ save: async () => { calls += 1; return { chargedCount: 1, eventChargeLimitReached: false }; },
        write: async (key, value) => { if (key === 'COMPARISON.csv') throw new Error('private upload error'); memory.files.set(key, value); } });
    await assert.rejects(runWorkflow(importInput(), memory.ports, QA_NOW), /Report delivery failed/);
    assert.equal(calls, 1); assert.equal((memory.files.get('RUN_STATUS') as Record<string, unknown>).reportsComplete, false);
});
test('validation of all rows happens before any product charge, even behind maxResults', async () => {
    const memory = memoryPorts();
    await assert.rejects(runWorkflow(importInput([QA_OBSERVATION, { ...QA_PEER, price: -1 }], { maxResults: 1 }), memory.ports, QA_NOW), /price/);
    assert.equal(memory.saved.length, 0); assert.equal(memory.checks, 0);
});
for (const demoPreset of ['us-cost-comparison', 'us-margin-scenario', 'us-price-change-review']) {
    test(`synthetic ${demoPreset} never checks budget, saves/charges rows or makes source calls`, async () => {
        const memory = memoryPorts({ canSave: () => { throw new Error('must not check result budget'); }, save: async () => { throw new Error('must not save demo rows'); } });
        const summary = await runWorkflow({ mode: 'demo', demoPreset, retailPriceUsd: 20 }, memory.ports, QA_NOW);
        assert.equal(summary.savedProductCount, 0); assert.equal(summary.productResultEventCount, 0); assert.equal(summary.isSynthetic, true);
        assert.equal(summary.outcome, 'demo_complete'); assert.equal(summary.upstreamRequestCount, 0);
        assert(String(memory.files.get('REPORT.md')).includes('SYNTHETIC DEMO'));
        const json = memory.files.get('REPORT') as { products: ProductAnalysis[] };
        assert(json.products.every((record) => record.isSynthetic && record.productUrl === null && record.source === 'synthetic-demo'));
        assert(String(memory.files.get('COMPARISON.csv')).includes('"synthetic-demo","true"'));
    });
}
test('demo never silently ignores a real import export', async () => {
    const memory = memoryPorts();
    await assert.rejects(runWorkflow({ mode: 'demo', importJson: JSON.stringify([QA_OBSERVATION]) }, memory.ports, QA_NOW), /Demo uses fixed/);
    assert.equal(memory.saved.length, 0); assert.equal(memory.files.size, 0);
});
test('legacy saved tasks receive an actionable migration error before any results', async () => {
    const memory = memoryPorts();
    await assert.rejects(runWorkflow({ mode: 'demo', searchQueries: ['cables'] }, memory.ports, QA_NOW), /Live AliExpress collection is retired/);
    assert.equal(memory.files.size, 0); assert.equal(memory.saved.length, 0);
});
