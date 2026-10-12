import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalizeInput } from './input.js';
import { assertDemoInput } from './demo-presets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = async (file: string) => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
test('Store copy matches Actor manifest, stays bounded and explicitly discloses non-live fees', async () => {
    const [manifest, copy] = await Promise.all([json('.actor/actor.json'), json('release/store-copy.json')]);
    assert.equal(manifest.name, 'aliexpress-products-scraper'); assert.equal(manifest.description, copy.description);
    assert(manifest.title.length <= 64); assert(copy.description.length <= 300);
    assert(copy.seoTitle.length <= 50); assert(copy.seoDescription.length <= 156);
    assert(copy.description.includes('No live')); assert(copy.description.includes('platform usage fees'));
    assert(manifest.title.includes('US Sourcing'));
});
test('numeric result/start fees and separate user-paid platform policy are retained', async () => {
    const manifest = await json('.actor/actor.json');
    assert.equal(manifest.pricingInfo.pricingModel, 'PAY_PER_EVENT');
    assert.equal(manifest.pricingInfo.isPPEPlatformUsagePaidByUser, true);
    const events = manifest.pricingInfo.pricingPerEvent.actorChargeEvents;
    assert.deepEqual(Object.keys(events).sort(), ['apify-actor-start', 'product-scraped']);
    assert.equal(events['product-scraped'].eventPriceUsd, 0.003); assert.equal(events['apify-actor-start'].eventPriceUsd, 0.001);
    assert(events['product-scraped'].eventDescription.includes('No product event for demos'));
    assert(!events['product-scraped'].eventTieredPricingUsd);
});
test('full input and starter examples never auto-confirm rights or claim live lookup', async () => {
    const [schema, manifest, input, testInput] = await Promise.all([json('INPUT_SCHEMA.json'), json('.actor/actor.json'), json('input.json'), json('test_input.json')]);
    assert.equal(schema.properties.authorizedData.default, false);
    for (const key of ['importJson', 'importCsv']) assert.equal(schema.properties[key].isSecret, true);
    assert(!Object.hasOwn(schema.properties.mode, 'default'));
    for (const value of [input, testInput, JSON.parse(manifest.exampleRunInput.body)]) {
        assert.equal(normalizeInput(value).mode, 'demo'); assertDemoInput(value); assert.equal(value.authorizedData, undefined);
    }
});
test('all three prepared public examples are bounded synthetic previews with safe visible fields', async () => {
    const [examples, schema] = await Promise.all([json('release/us-examples.json'), json('INPUT_SCHEMA.json')]);
    assert.equal(examples.examples.length, 3); assert.equal(new Set(examples.examples.map((item: { name: string }) => item.name)).size, 3);
    for (const example of examples.examples) {
        const input = await json(example.inputFile);
        assert.equal(normalizeInput(input).mode, 'demo'); assertDemoInput(input);
        assert(example.title.length <= 63); assert(example.description.length <= 400); assert(example.title.includes('Synthetic Preview'));
        assert(!example.visibleFields.includes('mode')); assert.equal(input.authorizedData, undefined);
        for (const field of example.visibleFields) assert(schema.properties[field] && !schema.properties[field].isSecret);
    }
});
test('active production modules contain no marketplace request, browser or proxy path', async () => {
    const pkg = await json('package.json'); assert.deepEqual(Object.keys(pkg.dependencies), ['apify']);
    const docker = await fs.readFile(path.join(root, '.actor/Dockerfile'), 'utf8');
    assert(docker.startsWith('FROM apify/actor-node:20')); assert(!docker.includes('chrome')); assert(!docker.includes('xvfb'));
    const files = ['main.ts', 'input.ts', 'routes.ts', 'importer.ts', 'analysis.ts', 'decimal.ts', 'billing.ts', 'demo-presets.ts', 'workflow.ts'];
    for (const file of files) {
        const source = await fs.readFile(path.join(root, 'src', file), 'utf8');
        assert(!/\b(?:fetch|createProxyConfiguration|PlaywrightCrawler|CheerioCrawler)\s*\(/.test(source));
        assert(!/from ['"](?:playwright|puppeteer|crawlee|node:https?|axios|got)/.test(source));
    }
});
test('output links correspond to the complete artifact set in both modes', async () => {
    const schema = await json('.actor/output_schema.json');
    const values = Object.values(schema.properties) as { template: string }[];
    for (const key of ['RUN_STATUS', 'REPORT', 'COMPARISON.csv', 'FINDINGS.csv', 'QUALITY.csv', 'REPORT.md']) {
        assert(values.some((value) => value.template.endsWith(`/records/${key}`)));
    }
});
