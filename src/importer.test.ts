import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseCsv, prepareImport } from './importer.js';
import { InputError } from './input.js';
import { importInput, QA_NEXT, QA_NOW, QA_OBSERVATION, QA_PEER } from './test-fixtures.js';

test('imports one product with multiple supplied observations and strict preserved identity', () => {
    const plan = prepareImport(importInput([QA_NEXT, QA_OBSERVATION]), QA_NOW);
    assert.equal(plan.records.length, 1); assert.equal(plan.records[0].observationCount, 2);
    assert.equal(plan.records[0].source, 'user-authorized-import'); assert.equal(plan.records[0].isSynthetic, false);
    assert.equal(plan.records[0].observations[0].observedAt, '2026-10-10T00:00:00.000Z');
    assert.equal(plan.records[0].observations[0].productId, '00000001');
    assert.equal(plan.records[0].observations[0].calculatedDiscountPercent, 50);
});
test('default result cap means one whole product, not one observation', () => {
    const plan = prepareImport(importInput([QA_OBSERVATION, QA_NEXT, QA_PEER], { maxResults: undefined }), QA_NOW);
    assert.equal(plan.records.length, 1); assert.equal(plan.records[0].observationCount, 2); assert.equal(plan.omittedProductCount, 1);
});
test('deduplicates identical observations without duplicated result events', () => {
    const plan = prepareImport(importInput([QA_OBSERVATION, QA_OBSERVATION, QA_NEXT, QA_PEER]), QA_NOW);
    assert.equal(plan.duplicateObservationsRemoved, 1); assert.equal(plan.normalizedObservationCount, 3); assert.equal(plan.records.length, 2);
});
test('conflicts are rejected even when the bad product would be omitted by the cap', () => {
    assert.throws(() => prepareImport(importInput([QA_OBSERVATION, QA_PEER, { ...QA_PEER, price: 99 }], { maxResults: 1 }), QA_NOW), /conflicting/);
});
test('keeps multiple variants, currencies and offer contexts separate under one product fee', () => {
    const plan = prepareImport(importInput([QA_OBSERVATION, { ...QA_OBSERVATION, variant: '2 m / black' },
        { ...QA_OBSERVATION, currency: 'EUR' }, { ...QA_OBSERVATION, priceBasis: 'new-customer' }]), QA_NOW);
    assert.equal(plan.records.length, 1); assert.equal(plan.records[0].observationCount, 4);
});
test('strict aliases and unsupported secret fields do not leak', () => {
    const { productId, title, observedAt, ...rest } = QA_OBSERVATION;
    const plan = prepareImport(importInput([{ ...rest, id: productId, name: title, scrapedAt: observedAt,
        password: 'KEEP-PRIVATE', sellerEmail: 'private@example.test', authorization: 'Bearer secret' }]), QA_NOW);
    assert.equal(plan.unsupportedColumnsDropped, 3); assert(!JSON.stringify(plan).includes('KEEP-PRIVATE'));
    assert(!JSON.stringify(plan).includes('private@example.test')); assert(!JSON.stringify(plan).includes('Bearer secret'));
    assert.throws(() => prepareImport(importInput([{ ...QA_OBSERVATION, id: '00000001' }]), QA_NOW), /multiple columns/);
});
test('prototype-like input keys are safely ignored, never assigned into Object.prototype', () => {
    const raw = JSON.parse(JSON.stringify(QA_OBSERVATION).slice(0, -1) + ',"__proto__":{"polluted":true},"constructor":"hidden"}');
    const plan = prepareImport(importInput([raw]), QA_NOW);
    assert.equal(plan.unsupportedColumnsDropped, 2); assert.equal(({} as Record<string, unknown>).polluted, undefined);
});
for (const consent of [undefined, null, false, 'true', 1]) {
    test(`explicit rights confirmation required ${JSON.stringify(consent)}`, () => {
        assert.throws(() => prepareImport(importInput([QA_OBSERVATION], { authorizedData: consent }), QA_NOW), /Confirm authorizedData/);
    });
}
for (const source of [undefined, null, '', ' ', 1, 'a'.repeat(161)]) {
    test(`provider/source label required ${String(JSON.stringify(source)).slice(0, 40)}`, () => {
        assert.throws(() => prepareImport(importInput([QA_OBSERVATION], { importSource: source }), QA_NOW), /importSource/);
    });
}
for (const rows of [[], [null], [1], [[]], [{ ...QA_OBSERVATION, productId: 10050000000000000 }], [{ ...QA_OBSERVATION, productId: '1e20' }],
    [{ ...QA_OBSERVATION, productId: '123' }], [{ ...QA_OBSERVATION, title: '' }], [{ ...QA_OBSERVATION, title: {} }]]) {
    test(`rejects malformed observation ${JSON.stringify(rows).slice(0, 60)}`, () => assert.throws(() => prepareImport(importInput(rows), QA_NOW), InputError));
}
for (const date of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-10-10T24:00:00Z', '2026-10-10T00:00:60Z',
    '10/10/2026', '2026-10-10T00:00:00', '2026-10-10T00:00:00+00:00', '2026-10-13', '', null]) {
    test(`rejects missing/impossible/ambiguous/future time ${JSON.stringify(date)}`, () => {
        assert.throws(() => prepareImport(importInput([{ ...QA_OBSERVATION, observedAt: date }]), QA_NOW), /observedAt/);
    });
}
test('accepts leap day and UTC subsecond timestamps exactly', () => {
    const plan = prepareImport(importInput([{ ...QA_OBSERVATION, observedAt: '2024-02-29T12:30:10.25Z' }]), QA_NOW);
    assert.equal(plan.records[0].observations[0].observedAt, '2024-02-29T12:30:10.250Z');
});
for (const [field, value] of [['price', '-1'], ['shippingCost', 'US$4'], ['taxCost', '=1'], ['rating', 5.1], ['soldCount', '1.2K'],
    ['ratingCount', 4.5], ['discountPercent', 101], ['deliveryDaysMax', 4000], ['inStock', 'yes'], ['inStock', 0],
    ['currency', '$'], ['shipToCountry', 'USA'], ['priceBasis', 'unconditional'], ['quantityBasis', 'box']]) {
    test(`strict observation field ${field}:${value}`, () => assert.throws(() => prepareImport(importInput([{ ...QA_OBSERVATION, [field]: value }]), QA_NOW), InputError));
}
test('included tax is not added twice and impossible delivery intervals are rejected', () => {
    assert.throws(() => prepareImport(importInput([{ ...QA_OBSERVATION, taxBasis: 'included' }]), QA_NOW), /do not add included tax/);
    assert.throws(() => prepareImport(importInput([{ ...QA_OBSERVATION, deliveryDaysMin: 11 }]), QA_NOW), /deliveryDaysMin/);
    const row = prepareImport(importInput([{ ...QA_OBSERVATION, taxBasis: 'included', taxCost: 0, inStock: 'false' }]), QA_NOW).records[0].observations[0];
    assert.equal(row.inStock, false); assert.equal(row.taxCost, 0);
});
test('missing values remain unknown and no default USD, US, stock or shipping is inferred', () => {
    const row = prepareImport(importInput([{ productId: '00000001', title: 'Minimal', observedAt: '2026-10-10', price: 0 }]), QA_NOW).records[0].observations[0];
    assert.equal(row.currency, null); assert.equal(row.shipToCountry, null); assert.equal(row.variant, null);
    assert.equal(row.shippingCost, null); assert.equal(row.inStock, null); assert.equal(row.priceBasis, 'unknown');
    assert.equal(row.brand, null); assert.equal(row.productUrl, null);
});
test('source URLs are canonicalized and never fetched', () => {
    const row = prepareImport(importInput([{ ...QA_OBSERVATION, productUrl: 'https://www.aliexpress.us/item/00000001.html?secret=private',
        imageUrl: '//ae01.alicdn.com/kf/test.jpg?token=private' }]), QA_NOW).records[0].observations[0];
    assert.equal(row.productUrl, 'https://www.aliexpress.us/item/00000001.html'); assert(!row.imageUrl!.includes('token'));
    assert.throws(() => prepareImport(importInput([{ ...QA_OBSERVATION, productUrl: 'https://localhost/item/00000001.html' }]), QA_NOW), /productUrl/);
});
test('CSV handles BOM, CRLF, quotes, escaped quotes and blank lines', () => {
    const rows = parseCsv('\uFEFFproductId,title,price,observedAt\r\n00000001,"A, ""quoted"" cable",4,2026-10-10\r\n\r\n');
    assert.equal(rows.length, 1); assert.equal(rows[0].title, 'A, "quoted" cable');
    const plan = prepareImport({ mode: 'import', authorizedData: true, importSource: 'Owned CSV', importCsv: 'productId,title,price,observedAt\n00000001,A,4,2026-10-10' }, QA_NOW);
    assert.equal(plan.records.length, 1);
});
for (const csv of ['', 'productId,title', 'id,productId,title\n00000001,00000001,A', 'id,,title\n1,2,A',
    'id,title\n1,"unclosed', 'id,title\n1,A"bad', 'id,title\n1,"ok"bad', 'id,title\n1,A,B', 'id,title\n1,A\0']) {
    test(`malformed CSV rejected ${JSON.stringify(csv).slice(0, 65)}`, () => assert.throws(() => parseCsv(csv), InputError));
}
test('bounded exports reject oversized bytes, excessive rows and multi-source input', () => {
    assert.throws(() => prepareImport(importInput([QA_OBSERVATION], { importJson: 'x'.repeat(MAX_IMPORT_BYTES + 1) }), QA_NOW), /2 MiB/);
    assert.throws(() => prepareImport(importInput(Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => QA_OBSERVATION)), QA_NOW), /1–1,000/);
    assert.throws(() => prepareImport(importInput([QA_OBSERVATION], { importCsv: 'a,b\n1,2' }), QA_NOW), /exactly one/);
    assert.throws(() => prepareImport(importInput([QA_OBSERVATION], { importJson: 'https://example.test/data.json' }), QA_NOW), /valid JSON/);
    assert.throws(() => parseCsv('a\n' + 'x\n'.repeat(1001)), /1,000/);
    assert.throws(() => parseCsv(Array.from({ length: 61 }, (_, i) => `a${i}`).join(',') + '\n' + 'x,'.repeat(60) + 'x'), /60 columns/);
});
test('invalid JSON errors do not expose raw payload content', () => {
    assert.throws(() => prepareImport(importInput([], { importJson: 'TOP-SECRET-INVALID-PAYLOAD' }), QA_NOW), (error) => {
        assert(error instanceof InputError); assert(!error.message.includes('TOP-SECRET')); return true;
    });
});
