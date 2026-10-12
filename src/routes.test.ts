import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, markdownText, parseNumber, redactSensitiveText, safeImageUrl, safeProductUrl } from './routes.js';
import { InputError, normalizeInput, scenarioOptions, selectMode } from './input.js';

for (const [value, expected] of [[0, 0], [12.5, 12.5], ['1,234.56', 1234.56], ['1234', 1234], [' 0.5 ', 0.5]] as const) {
    test(`strict numeric scalar accepts ${JSON.stringify(value)}`, () => assert.equal(parseNumber(value), expected));
}
for (const value of [undefined, null, true, false, '', ' ', 'US $7.58', '1.234,56', '-1', '7–9', '1,23',
    '1.2K', '5%', '=SUM(1,2)', 'Infinity', 'NaN', '+4', '1e3', '.5', [], {}, -1, NaN, Infinity, 1_000_000_001]) {
    test(`rejects ambiguous/non-numeric scalar ${JSON.stringify(value)}`, () => assert.equal(parseNumber(value), null));
}
test('numeric bounds, integer constraints and no rounding of supplied values', () => {
    assert.equal(parseNumber('4.9', 0, 5), 4.9); assert.equal(parseNumber(5.1, 0, 5), null);
    assert.equal(parseNumber('2.5', 0, 100, true), null); assert.equal(parseNumber('2.0', 0, 100, true), 2);
    assert.equal(parseNumber(4.99999999), 4.99999999);
});
test('explicit demo/import modes only and defaults are bounded', () => {
    const demo = normalizeInput({ mode: 'demo' });
    assert.equal(demo.maxResults, 1); assert.equal(demo.demoPreset, 'us-cost-comparison');
    assert.equal(demo.scenario.retailPriceUsd, null); assert.equal(demo.scenario.targetContributionMarginPercent, 25);
    assert.equal(selectMode({ mode: 'import' }), 'import');
    assert.throws(() => selectMode({}), /Select mode/);
});
for (const legacy of ['searchQueries', 'searchQuery', 'startUrls', 'productUrls', 'maxPagesPerQuery', 'proxyConfiguration']) {
    test(`legacy ${legacy} never silently becomes a synthetic search`, () => {
        assert.throws(() => selectMode({ mode: 'demo', [legacy]: [] }), (error) => error instanceof InputError && error.code === 'LEGACY_INPUT_RETIRED');
    });
}
for (const input of [null, undefined, [], 'demo', 1, { mode: 'live' }, { mode: ['demo'] }, { mode: 'demo', demoPreset: ['us-cost-comparison'] },
    { mode: 'demo', maxResults: 0 }, { mode: 'demo', maxResults: 1.5 }, { mode: 'demo', maxResults: 501 }, { mode: 'demo', maxResults: '25' }]) {
    test(`rejects invalid input shape/options ${JSON.stringify(input)}`, () => assert.throws(() => normalizeInput(input), InputError));
}
for (const field of ['marketplaceFeePercent', 'paymentFeePercent', 'returnsReservePercent', 'fixedFeeUsd', 'fulfillmentCostUsd', 'adCostUsd',
    'targetContributionMarginPercent', 'priceChangeThresholdPercent', 'landedCostRiseThresholdPercent', 'deliveryIncreaseThresholdDays', 'comparisonWindowDays']) {
    test(`scenario ${field} rejects coerced strings and negative values`, () => {
        assert.throws(() => scenarioOptions({ [field]: '5' }), InputError);
        assert.throws(() => scenarioOptions({ [field]: -1 }), InputError);
    });
}
test('scenario rates cannot exhaust revenue and zero retail is not a usable scenario', () => {
    assert.throws(() => scenarioOptions({ marketplaceFeePercent: 70, paymentFeePercent: 20, returnsReservePercent: 10 }), /below 100/);
    assert.throws(() => scenarioOptions({ retailPriceUsd: 0 }), InputError);
    assert.throws(() => scenarioOptions({ comparisonWindowDays: 1.5 }), InputError);
});
test('canonical source URLs omit tracking without any requests', () => {
    assert.equal(safeProductUrl('http://www.aliexpress.us/item/00000001.html?token=hidden#ref', '00000001'), 'https://www.aliexpress.us/item/00000001.html');
    assert.equal(safeImageUrl('//ae-pic-a1.aliexpress-media.com/kf/test.jpg?token=hidden'), 'https://ae-pic-a1.aliexpress-media.com/kf/test.jpg');
    assert.equal(safeImageUrl('https://ae01.alicdn.com/kf/test.jpg'), 'https://ae01.alicdn.com/kf/test.jpg');
});
for (const url of ['javascript:alert(1)', 'file:///tmp/data', 'https://127.0.0.1/item/00000001.html',
    'https://aliexpress.com.evil.test/item/00000001.html', 'https://notaliexpress.com/item/00000001.html',
    'https://password@aliexpress.com/item/00000001.html', 'https://aliexpress.com:8443/item/00000001.html',
    'https://www.aliexpress.com/item/00000002.html', '//www.aliexpress.com/item/00000001.html']) {
    test(`unsafe/mismatched product URL rejected ${url}`, () => assert.equal(safeProductUrl(url, '00000001'), null));
}
for (const url of ['https://evil.test/img.jpg', 'https://alicdn.com.evil.test/img.jpg', 'data:image/png;base64,abc',
    'https://secret@alicdn.com/img.jpg', 'https://alicdn.com:9443/img.jpg']) {
    test(`unsafe image URL rejected ${url}`, () => assert.equal(safeImageUrl(url), null));
}
test('CSV formula guarding, escaped Markdown and sensitive text filtering', () => {
    for (const text of ['=1+1', '+cmd', '-cmd', '@lookup', '  =DDE()', '\tformula']) assert(csvCell(text).startsWith('"\''));
    assert.equal(csvCell(-10), '"-10"'); assert.equal(csvCell(null), '""'); assert.equal(csvCell('A"B'), '"A""B"');
    assert(!markdownText('<script>alert(1)</script> | [link](x)').includes('<script>'));
    const sanitized = redactSensitiveText('test@example.com +1 555 123 4567 api_key=supersecret Bearer tokenvalue');
    assert(!sanitized.includes('example.com')); assert(!sanitized.includes('supersecret')); assert(!sanitized.includes('tokenvalue'));
});
