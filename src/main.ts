import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { buildSearchUrl, extractProducts, isBlockedPage, scrollSearchResults } from './routes.js';
import type { ActorInput, RequestData } from './types.js';

await Actor.init();

const input = (await Actor.getInput<ActorInput>()) ?? { searchQueries: ['wireless earbuds'] };
const searchQueries = [...new Set((input.searchQueries ?? []).map((query) => query.trim()).filter(Boolean))];
const maxResults = Math.min(Math.max(input.maxResults ?? 50, 1), 500);
const maxPagesPerQuery = Math.min(Math.max(input.maxPagesPerQuery ?? 2, 1), 10);

if (searchQueries.length === 0) {
    throw new Error('Provide at least one non-empty search query.');
}

const proxyConfiguration = await Actor.createProxyConfiguration(
    input.proxyConfiguration ?? {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
        apifyProxyCountry: 'US',
    },
);

const seenProductIds = new Set<string>();
let savedCount = 0;
let spendingLimitReached = false;

const requests = searchQueries.flatMap((searchQuery) => Array.from(
    { length: maxPagesPerQuery },
    (_, index) => ({
        url: buildSearchUrl(searchQuery, index + 1),
        userData: { searchQuery, pageNumber: index + 1 } satisfies RequestData,
    }),
));

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    headless: false,
    maxConcurrency: 2,
    minConcurrency: 1,
    maxRequestRetries: 3,
    retryOnBlocked: true,
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 180,
    maxRequestsPerCrawl: requests.length,
    sessionPoolOptions: {
        maxPoolSize: 30,
        blockedStatusCodes: [],
        sessionOptions: { maxUsageCount: 10 },
    },
    browserPoolOptions: { useFingerprints: true },
    launchContext: {
        useChrome: true,
        launchOptions: {
            args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
        },
    },
    preNavigationHooks: [async ({ page }, gotoOptions) => {
        page.setDefaultTimeout(12_000);
        if (gotoOptions) gotoOptions.waitUntil = 'domcontentloaded';
        await page.waitForTimeout(1_000 + Math.floor(Math.random() * 2_000));
    }],
    requestHandler: async ({ page, request, session }) => {
        if (savedCount >= maxResults || spendingLimitReached) return;

        const { searchQuery, pageNumber } = request.userData as RequestData;
        await page.waitForSelector('a.search-card-item[href*="/item/"]', { timeout: 60_000 }).catch(() => null);

        if (await isBlockedPage(page)) {
            session?.markBad();
            throw new Error(`AliExpress challenge page detected for ${request.url}`);
        }

        await scrollSearchResults(page);
        const products = await extractProducts(page, searchQuery, pageNumber);
        if (products.length === 0) {
            if (pageNumber === 1) throw new Error(`No product cards found for "${searchQuery}".`);
            log.info(`No additional products found for "${searchQuery}" on page ${pageNumber}.`);
            return;
        }

        for (const product of products) {
            if (savedCount >= maxResults || spendingLimitReached) break;
            if (seenProductIds.has(product.productId)) continue;

            seenProductIds.add(product.productId);
            await Actor.pushData(product);
            const chargeResult = await Actor.charge({ eventName: 'product-scraped' });
            savedCount += 1;

            if (chargeResult.eventChargeLimitReached) {
                spendingLimitReached = true;
                await Actor.setStatusMessage(`Stopped at the user's spending limit after ${savedCount} products`);
                log.info('User spending limit reached; stopping before more requests are made.');
                await crawler.autoscaledPool?.abort();
                break;
            }
        }

        await Actor.setStatusMessage(`Saved ${savedCount}/${maxResults} AliExpress products`);
        log.info(`Processed "${searchQuery}" page ${pageNumber}: ${products.length} cards, ${savedCount} total saved.`);
    },
    failedRequestHandler: async ({ request }, error) => {
        log.error(`AliExpress request failed after retries: ${request.url}`, { error: String(error) });
    },
});

await crawler.run(requests);
await Actor.setStatusMessage(`Finished with ${savedCount} unique products`);
log.info(`AliExpress scrape finished with ${savedCount} unique products.`);

await Actor.exit();
