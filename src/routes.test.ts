import test from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { normalizeInput } from './input.js';
import {
    buildSearchUrl,
    currencyFrom,
    extractProducts,
    normalizeUrl,
    parseDiscount,
    parseMoney,
    parseOrders,
    productIdFromUrl,
    redactSensitiveText,
} from './routes.js';

test('normalizes input defaults and clamps numeric limits', () => {
    const defaults = normalizeInput({});
    assert.deepEqual(defaults.searchQueries, ['wireless earbuds']);
    assert.equal(defaults.maxResults, 1);
    assert.equal(defaults.maxPagesPerQuery, 1);
    assert.deepEqual(defaults.proxyConfiguration, {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
        apifyProxyCountry: 'US',
    });

    const custom = normalizeInput({
        searchQueries: [' phone case ', 'phone case', ''],
        maxResults: 999,
        maxPagesPerQuery: 99,
    });
    assert.deepEqual(custom.searchQueries, ['phone case']);
    assert.equal(custom.maxResults, 500);
    assert.equal(custom.maxPagesPerQuery, 10);

    assert.throws(() => normalizeInput({ searchQueries: ['   '] }), /at least one/);
});

test('builds canonical AliExpress search URLs', () => {
    assert.equal(
        buildSearchUrl('wireless earbuds', 1),
        'https://www.aliexpress.com/w/wholesale-wireless-earbuds.html?SearchText=wireless+earbuds',
    );
    assert.equal(
        buildSearchUrl('phone case', 2),
        'https://www.aliexpress.com/w/wholesale-phone-case.html?SearchText=phone+case&page=2',
    );
});

test('parses product values and redacts sensitive text', () => {
    assert.equal(parseMoney('US $1,234.56'), 1234.56);
    assert.equal(parseMoney('Rs. 999'), 999);
    assert.equal(parseDiscount('-42%'), 42);
    assert.equal(parseOrders('1.2K sold'), 1200);
    assert.equal(parseOrders('2M sold'), 2000000);
    assert.equal(currencyFrom('CA$ 12.00'), 'CAD');
    assert.equal(currencyFrom('AU$ 12.00'), 'AUD');
    assert.equal(currencyFrom('\u20ac12.00'), 'EUR');
    assert.equal(currencyFrom('\u20b912.00'), 'INR');
    assert.equal(normalizeUrl('//ae-pic-a1.aliexpress-media.com/kf/example.jpg'), 'https://ae-pic-a1.aliexpress-media.com/kf/example.jpg');
    assert.equal(productIdFromUrl('https://www.aliexpress.com/item/3256812072210872.html'), '3256812072210872');
    assert.equal(
        redactSensitiveText('Seller email test@example.com phone +1 555 123 4567'),
        'Seller email [redacted] phone [redacted]',
    );
});

test('extracts clean product records from rendered cards', async () => {
    const page = {
        evaluate: async () => [{
            href: 'https://www.aliexpress.com/item/3256812072210872.html',
            title: 'Xiaomi earbuds test@example.com +1 555 123 4567',
            priceText: 'US $7.58',
            originalPriceText: 'US $15.16',
            discountText: '-50%',
            ratingText: '4.9',
            ordersText: '1.2K sold',
            storeName: 'Example Store',
            imageUrl: '//ae-pic-a1.aliexpress-media.com/kf/example.jpg',
        }],
    } as unknown as Page;

    const records = await extractProducts(page, 'wireless earbuds', 2);

    assert.equal(records.length, 1);
    assert.equal(records[0].source, 'aliexpress');
    assert.equal(records[0].searchQuery, 'wireless earbuds');
    assert.equal(records[0].position, 2);
    assert.equal(records[0].productId, '3256812072210872');
    assert.equal(records[0].title, 'Xiaomi earbuds [redacted] [redacted]');
    assert.equal(records[0].price, 7.58);
    assert.equal(records[0].mrp, 15.16);
    assert.equal(records[0].discountPercent, 50);
    assert.equal(records[0].currency, 'USD');
    assert.equal(records[0].rating, 4.9);
    assert.equal(records[0].soldCount, 1200);
    assert.equal(records[0].productUrl, 'https://www.aliexpress.com/item/3256812072210872.html');
    assert.equal(records[0].imageUrl, 'https://ae-pic-a1.aliexpress-media.com/kf/example.jpg');
});
