import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BillingAcknowledgmentError, PRODUCT_EVENT, saveConfirmedProduct } from './billing.js';
import type { ProductChargingManager } from './billing.js';
import { runWorkflow } from './workflow.js';
import { importInput, QA_NEXT, QA_NOW, QA_OBSERVATION, QA_PEER } from './test-fixtures.js';

test('combined two-event acknowledgment normalizes to one custom product without charging twice', async () => {
    let counter = 0, calls = 0;
    const manager: ProductChargingManager = { getPricingInfo: () => ({ isPayPerEvent: true, perEventPrices: { [PRODUCT_EVENT]: 0.003 } }),
        getChargedEventCount: () => counter, calculateMaxEventChargeCountWithinLimit: () => counter ? 0 : 1 };
    const result = await saveConfirmedProduct({ id: 'fixture' }, { manager, push: async (_, event) => {
        calls += 1; assert.equal(event, PRODUCT_EVENT); counter += 1; return { chargedCount: 2, eventChargeLimitReached: true };
    } });
    assert.deepEqual(result, { chargedCount: 1, eventChargeLimitReached: true }); assert.equal(calls, 1);
});

const invalidPrices: Record<string, number>[] = [{}, { [PRODUCT_EVENT]: 0 }, { [PRODUCT_EVENT]: NaN }, { [PRODUCT_EVENT]: 0.003, 'apify-default-dataset-item': 0.001 }];
for (const prices of invalidPrices) {
    test(`invalid/extra pricing is blocked before a product write ${JSON.stringify(prices)}`, async () => {
        let calls = 0;
        const manager: ProductChargingManager = { getPricingInfo: () => ({ isPayPerEvent: true, perEventPrices: prices }),
            getChargedEventCount: () => 0, calculateMaxEventChargeCountWithinLimit: () => 1 };
        await assert.rejects(saveConfirmedProduct({}, { manager, push: async () => { calls += 1; return { chargedCount: 1, eventChargeLimitReached: false }; } }), BillingAcknowledgmentError);
        assert.equal(calls, 0);
    });
}

for (const delta of [-1, 0, 2]) {
    test(`missing/inconsistent custom delta ${delta} is not accepted as billed output`, async () => {
        let counter = 1;
        const manager: ProductChargingManager = { getPricingInfo: () => ({ isPayPerEvent: true, perEventPrices: { [PRODUCT_EVENT]: 0.003 } }),
            getChargedEventCount: () => counter, calculateMaxEventChargeCountWithinLimit: () => 1 };
        await assert.rejects(saveConfirmedProduct({}, { manager, push: async () => { counter += delta; return { chargedCount: 2, eventChargeLimitReached: false }; } }), BillingAcknowledgmentError);
    });
}

test('local non-PPE save has no fictitious custom charge', async () => {
    const manager: ProductChargingManager = { getPricingInfo: () => ({ isPayPerEvent: false, perEventPrices: {} }),
        getChargedEventCount: () => 0, calculateMaxEventChargeCountWithinLimit: () => Infinity };
    assert.deepEqual(await saveConfirmedProduct({}, { manager, push: async () => ({ chargedCount: 0, eventChargeLimitReached: false }) }),
        { chargedCount: 0, eventChargeLimitReached: false });
});

test('a genuine zero-custom exhausted limit remains unsaved, not a false completed product', async () => {
    const manager: ProductChargingManager = { getPricingInfo: () => ({ isPayPerEvent: true, perEventPrices: { [PRODUCT_EVENT]: 0.003 } }),
        getChargedEventCount: () => 0, calculateMaxEventChargeCountWithinLimit: () => 0 };
    assert.deepEqual(await saveConfirmedProduct({}, { manager, push: async () => ({ chargedCount: 0, eventChargeLimitReached: true }) }),
        { chargedCount: 0, eventChargeLimitReached: true });
});

const require = createRequire(import.meta.url);
// Test the installed SDK's real charge aggregation with an entirely fake API client.
// Internal SDK import is test-only; production uses public Actor/ChargingManager APIs.
const { ChargingManager, pushDataAndCharge } = require(path.join(path.dirname(require.resolve('apify')), 'charging.js'));
for (const maxResults of [1, 2]) {
    test(`real SDK PPE aggregation at exact ${maxResults}-product cap delivers complete reports with no network`, async () => {
        const sdkCharges: { eventName: string; count: number }[] = [], rows: unknown[] = [], files = new Map<string, unknown>();
        const config: Record<string, unknown> = { isAtHome: true, actorRunId: 'offline-fixture', maxTotalChargeUsd: 0.001 + maxResults * 0.003,
            actorPricingInfo: JSON.stringify({ pricingModel: 'PAY_PER_EVENT', pricingPerEvent: { actorChargeEvents: {
                [PRODUCT_EVENT]: { eventPriceUsd: 0.003, eventTitle: 'Product' }, 'apify-actor-start': { eventPriceUsd: 0.001, eventTitle: 'Start' },
            } } }), chargedEventCounts: JSON.stringify({ 'apify-actor-start': 1 }), useChargingLogDataset: false };
        const manager = new ChargingManager({ get: (key: string) => config[key] }, {
            run: () => ({ charge: async (value: { eventName: string; count: number }) => { sdkCharges.push(value); } }),
        });
        await manager.init();
        const rawCounts: number[] = [];
        const summary = await runWorkflow(importInput([QA_OBSERVATION, QA_NEXT, QA_PEER], { maxResults }), {
            canSave: () => manager.calculateMaxEventChargeCountWithinLimit(PRODUCT_EVENT) > 0,
            save: (record) => saveConfirmedProduct(record, { manager, push: async (value, eventName) => {
                const result = await pushDataAndCharge({ chargingManager: manager, items: value, eventName, isDefaultDataset: true,
                    pushFn: async (item: unknown) => { rows.push(item); } });
                rawCounts.push(result.chargedCount); return result;
            } }), write: async (key, value) => { files.set(key, value); }, status: async () => undefined,
        }, QA_NOW);
        assert.deepEqual(rawCounts, Array.from({ length: maxResults }, () => 2));
        assert.equal(sdkCharges.length, maxResults); assert(sdkCharges.every((value) => value.eventName === PRODUCT_EVENT && value.count === 1));
        assert.equal(rows.length, maxResults); assert.equal(summary.savedProductCount, maxResults);
        assert.equal(summary.productResultEventCount, maxResults); assert.equal(summary.outcome, 'succeeded');
        assert.equal(summary.completeSelectedOutput, true); assert.equal(summary.spendingLimitReached, true);
        assert.equal(summary.reportsComplete, true); assert.equal(files.size, 6);
    });
}
