import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, comparisonCsv, costCheck, findingsCsv, qualityCsv, reportMarkdown } from './analysis.js';
import { prepareImport } from './importer.js';
import { scenarioOptions } from './input.js';
import { importInput, QA_NEXT, QA_NOW, QA_OBSERVATION, QA_PEER } from './test-fixtures.js';

const report = (rows: Record<string, unknown>[], options: Record<string, unknown> = {}) => buildReport(prepareImport(importInput(rows), QA_NOW).records, scenarioOptions(options));
test('entered cost uses supplied price, shipping, additional tax and duty only', () => {
    const row = report([QA_OBSERVATION]).comparisons[0];
    assert.equal(row.enteredLandedCost, 6.5); assert.deepEqual(row.missingCostFields, []);
    assert.equal(row.scenario.status, 'not_requested'); assert.equal(row.scenario.contributionUsd, null);
});
for (const field of ['shippingCost', 'taxCost', 'dutyCost', 'currency', 'shipToCountry']) {
    test(`missing ${field} is not silently zero/defaulted`, () => {
        const row = report([{ ...QA_OBSERVATION, [field]: null }], { retailPriceUsd: 20 }).comparisons[0];
        assert.equal(row.enteredLandedCost, null); assert.equal(row.scenario.contributionMarginPercent, null);
        assert(row.qualityFlags.some((flag) => flag.includes(field)));
    });
}
test('hypothetical US contribution math, break-even and target ad budget are evidence based', () => {
    const row = report([QA_OBSERVATION], { retailPriceUsd: 20, marketplaceFeePercent: 10, paymentFeePercent: 5,
        returnsReservePercent: 5, fixedFeeUsd: 0.5, fulfillmentCostUsd: 1.5, adCostUsd: 2 }).comparisons[0];
    assert.equal(row.scenario.status, 'calculated'); assert.equal(row.scenario.contributionUsd, 5.5);
    assert.equal(row.scenario.contributionMarginPercent, 27.5); assert.equal(row.scenario.breakEvenRetailUsd, 13.125);
    assert.equal(row.scenario.maxAdSpendForTargetUsd, 2.5); assert.equal(row.scenario.meetsTarget, true);
});
test('negative contribution and unaffordable target budget are not clipped or called profitable', () => {
    const row = report([{ ...QA_OBSERVATION, price: 90 }], { retailPriceUsd: 20, marketplaceFeePercent: 10,
        paymentFeePercent: 5, returnsReservePercent: 5, fixedFeeUsd: 0.5, fulfillmentCostUsd: 1.5, adCostUsd: 2 }).comparisons[0];
    assert.equal(row.scenario.contributionUsd, -80.5); assert.equal(row.scenario.meetsTarget, false);
    assert.equal(row.scenario.maxAdSpendForTargetUsd, -83.5);
});
for (const priceBasis of ['new-customer', 'conditional', 'unknown']) {
    test(`non-standard ${priceBasis} prices do not become repeatable US margin claims`, () => {
        const row = report([{ ...QA_OBSERVATION, priceBasis }], { retailPriceUsd: 20 }).comparisons[0];
        assert.equal(row.scenario.status, 'non_standard_offer'); assert.equal(row.scenario.contributionMarginPercent, null);
        assert.equal(row.comparisonStatus, 'context_missing');
    });
}
for (const scope of [{ currency: 'EUR' }, { shipToCountry: 'GB' }]) {
    test(`US scenarios never convert or relabel ${JSON.stringify(scope)}`, () => {
        const row = report([{ ...QA_OBSERVATION, ...scope }], { retailPriceUsd: 20 }).comparisons[0];
        assert.equal(row.scenario.status, 'non_us_usd_scope'); assert.equal(row.scenario.contributionUsd, null);
        assert.equal(row.observation.currency, scope.currency ?? 'USD'); assert.equal(row.observation.shipToCountry, scope.shipToCountry ?? 'US');
    });
}
test('per-order/unknown quantities never become per-unit economics', () => {
    for (const quantityBasis of ['per-order', 'unknown']) {
        const row = report([{ ...QA_OBSERVATION, quantityBasis }], { retailPriceUsd: 20 }).comparisons[0];
        assert.equal(row.enteredLandedCost, null); assert.equal(row.scenario.status, 'incomplete_costs');
    }
});
test('matching supplied observations produce exact price/cost/delivery/stock findings', () => {
    const analysis = report([QA_OBSERVATION, QA_NEXT]);
    assert.equal(analysis.comparisons[1].comparisonStatus, 'comparable'); assert.equal(analysis.comparisons[1].elapsedDays, 1);
    assert.equal(analysis.comparisons[1].enteredLandedCost, 8.5);
    assert.equal(analysis.comparisons[1].priceChangePercent, 25); assert.equal(analysis.comparisons[1].landedCostChangePercent, 30.769231);
    assert.deepEqual(analysis.findings.map((item) => item.type), ['price_changed', 'entered_cost_increased', 'delivery_slower', 'supplied_stock_out']);
    assert.equal(analysis.findings[0].previousValue, 4); assert.equal(analysis.findings[0].currentValue, 5);
    assert.equal(analysis.findings[0].previousObservedAt, '2026-10-10T00:00:00.000Z'); assert.equal(analysis.findings[0].isSynthetic, false);
});
test('price decreases have negative raw change and threshold evidence, not invented sales growth', () => {
    const analysis = report([QA_OBSERVATION, { ...QA_NEXT, price: 3, deliveryDaysMax: 10, inStock: true, shippingCost: 2 }]);
    assert.equal(analysis.comparisons[1].priceChangePercent, -25);
    assert.deepEqual(analysis.findings.map((item) => item.type), ['price_changed']);
});
for (const scope of [{ variant: '2 m / white' }, { currency: 'EUR' }, { shipToCountry: 'CA' },
    { priceBasis: 'new-customer' }, { taxBasis: 'included', taxCost: 0 }, { quantityBasis: 'per-order' }]) {
    test(`mismatched scope never becomes a price percentage ${JSON.stringify(scope)}`, () => {
        const analysis = report([QA_OBSERVATION, { ...QA_NEXT, ...scope }]);
        assert.equal(analysis.comparisons[1].priceChangePercent, null);
        assert(!analysis.findings.some((finding) => finding.type === 'price_changed'));
        assert(!analysis.findings.some((finding) => finding.type === 'entered_cost_increased'));
    });
}
test('offer context drift is disclosed without comparing new-shopper and standard prices', () => {
    const analysis = report([{ ...QA_OBSERVATION, priceBasis: 'new-customer', price: 0.99 }, QA_NEXT]);
    assert.equal(analysis.findings.length, 1); assert.equal(analysis.findings[0].type, 'offer_context_changed');
    assert.equal(analysis.findings[0].change, null); assert.equal(analysis.comparisons[1].priceChangePercent, null);
});
test('window gaps remain explicit and do not emit numeric or stock findings', () => {
    const analysis = report([{ ...QA_OBSERVATION, observedAt: '2026-08-01' }, QA_NEXT]);
    assert.equal(analysis.comparisons[1].comparisonStatus, 'gap_exceeds_window'); assert(analysis.comparisons[1].elapsedDays! > 30);
    assert.equal(analysis.comparisons[1].priceChangePercent, null); assert.equal(analysis.findings.length, 0);
});
test('zero baselines do not invent percent changes', () => {
    const analysis = report([{ ...QA_OBSERVATION, price: 0, shippingCost: 0, taxCost: 0, dutyCost: 0 }, { ...QA_NEXT, inStock: true, deliveryDaysMax: 10 }]);
    assert.equal(analysis.comparisons[1].priceChangePercent, null); assert.equal(analysis.comparisons[1].landedCostChangePercent, null);
    assert.equal(analysis.findings.length, 0);
});
test('display rounding never triggers a near-threshold false price alert', () => {
    const analysis = report([{ ...QA_OBSERVATION, price: 100 }, { ...QA_NEXT, price: 104.999999999, shippingCost: 2,
        taxCost: 0.5, deliveryDaysMax: 10, inStock: true }], { landedCostRiseThresholdPercent: 100 });
    assert.equal(analysis.comparisons[1].priceChangePercent, 5);
    assert(!analysis.findings.some((finding) => finding.type === 'price_changed'));
});
test('a decimal-exact five-percent boundary is not falsely missed by floating-point arithmetic', () => {
    const analysis = report([{ ...QA_OBSERVATION, price: 9 }, { ...QA_NEXT, price: 9.45, shippingCost: 2,
        taxCost: 0.5, deliveryDaysMax: 10, inStock: true }], { landedCostRiseThresholdPercent: 100 });
    assert(analysis.findings.some((finding) => finding.type === 'price_changed'));
    assert.equal(analysis.comparisons[1].priceChangePercent, 5);
});
test('missing cost components prevent cost alerts, even with a valid price comparison', () => {
    const analysis = report([QA_OBSERVATION, { ...QA_NEXT, shippingCost: null }]);
    assert.equal(analysis.comparisons[1].comparisonStatus, 'comparable'); assert.equal(analysis.comparisons[1].landedCostChangePercent, null);
    assert(!analysis.findings.some((finding) => finding.type === 'entered_cost_increased'));
});
test('peer rank uses only saved complete-cost standard quotes at the exact supplied time/group/scope', () => {
    const analysis = report([QA_OBSERVATION, QA_PEER]);
    assert.equal(analysis.comparisons[0].completeCostPeerCount, 2); assert.equal(analysis.comparisons[0].enteredCostRank, 2);
    assert.equal(analysis.comparisons[1].enteredCostRank, 1);
});
for (const scope of [{ observedAt: '2026-10-11' }, { comparisonGroup: 'Other comparison' }, { currency: 'EUR' },
    { shipToCountry: 'GB' }, { priceBasis: 'new-customer' }, { taxCost: null }]) {
    test(`peer ranking excludes unmatched/incomplete quote ${JSON.stringify(scope)}`, () => {
        const analysis = report([QA_OBSERVATION, { ...QA_PEER, ...scope }]);
        assert.equal(analysis.comparisons[0].enteredCostRank, null); assert.equal(analysis.comparisons[1].enteredCostRank, null);
    });
}
test('multiple variants of one product are not invented competing products', () => {
    const analysis = report([QA_OBSERVATION, { ...QA_OBSERVATION, variant: '2 m', price: 3 }]);
    assert(analysis.comparisons.every((row) => row.enteredCostRank === null));
});
test('raw entered costs, not rounded display values, determine peer ranks', () => {
    const analysis = report([{ ...QA_OBSERVATION, price: 3.00000001 }, { ...QA_PEER, price: 3.00000009 }]);
    assert.equal(analysis.comparisons[0].enteredCostRank, 1); assert.equal(analysis.comparisons[1].enteredCostRank, 2);
});
test('tied complete-cost quotes use honest competition ranks rather than inventing a winner', () => {
    const analysis = report([QA_OBSERVATION, { ...QA_PEER, price: 4 }, { ...QA_PEER, productId: '00000003', price: 5 }]);
    assert.deepEqual(analysis.comparisons.map((row) => row.enteredCostRank), [1, 1, 3]);
});
test('discount math audits source labels without assuming reference prices or exact demand', () => {
    const analysis = report([{ ...QA_OBSERVATION, discountPercent: 90 }, { ...QA_PEER, mrp: 1 }]);
    assert(analysis.comparisons[0].qualityFlags.includes('discount_arithmetic_mismatch'));
    assert(analysis.comparisons[0].qualityFlags.includes('sold_count_not_declared_exact'));
    assert(analysis.comparisons[1].qualityFlags.includes('price_above_supplied_reference'));
    assert.equal(analysis.comparisons[1].observation.calculatedDiscountPercent, -200);
});
test('country-scope audit counts unknown and other observations without rewriting them', () => {
    const analysis = report([QA_OBSERVATION, { ...QA_NEXT, shipToCountry: null }, { ...QA_PEER, shipToCountry: 'GB' }]);
    assert.equal(analysis.usScopeCount, 1); assert.equal(analysis.otherScopeCount, 1); assert.equal(analysis.unknownScopeCount, 1);
});
test('safe report exports expose provenance and warnings, never input secrets or HTML/formula injection', () => {
    const analysis = report([{ ...QA_OBSERVATION, title: '=HYPERLINK("https://evil.test")', variant: '<script>danger</script>', password: 'RAW-PRIVATE' }, QA_NEXT]);
    const csv = comparisonCsv(analysis), markdown = reportMarkdown(analysis);
    assert(csv.includes('"\'=HYPERLINK')); assert(!csv.includes('RAW-PRIVATE'));
    assert(markdown.includes('&lt;script&gt;')); assert(!markdown.includes('<script>'));
    assert(markdown.includes('not net profit')); assert(markdown.includes('No persistent history'));
    assert(findingsCsv(analysis).includes('isSynthetic')); assert(qualityCsv(analysis).includes('qualityFlags'));
});
test('included tax still requires an explicit additional tax value and no estimated rate', () => {
    const item = report([{ ...QA_OBSERVATION, taxBasis: 'included', taxCost: null }]).comparisons[0].observation;
    assert.equal(costCheck(item).enteredLandedCost, null);
});
