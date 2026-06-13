import type { Page } from 'playwright';
import type { ProductRecord } from './types.js';

interface RawProduct {
    href: string;
    title: string;
    priceText: string | null;
    originalPriceText: string | null;
    discountText: string | null;
    ratingText: string | null;
    ordersText: string | null;
    storeName: string | null;
    imageUrl: string | null;
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<!\w)(?:\+?\d[\s().-]*){9,}(?!\w)/g;

export function redactSensitiveText(value: string): string {
    return value
        .replace(EMAIL_PATTERN, '[redacted]')
        .replace(PHONE_PATTERN, '[redacted]')
        .replace(/\s+/g, ' ')
        .trim();
}

export function buildSearchUrl(query: string, pageNumber: number): string {
    const slug = query
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'products';
    const params = new URLSearchParams({ SearchText: query });
    if (pageNumber > 1) params.set('page', String(pageNumber));
    return `https://www.aliexpress.com/w/wholesale-${slug}.html?${params.toString()}`;
}

function parseMoney(value: string | null): number | null {
    if (!value) return null;
    const normalized = value.replace(/\u00a0/g, ' ').trim();
    const currencyAmount = normalized.match(
        /(?:US\s*)?(?:CA\$|AU\$|[$\u20ac\u00a3\u20b9])\s*(\d[\d,]*(?:\.\d+)?)/i,
    )?.[1];
    const numericAmount = currencyAmount ?? normalized.match(/\d[\d,]*(?:\.\d+)?/)?.[0];
    if (!numericAmount) return null;
    const parsed = Number.parseFloat(numericAmount.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
}

function parseDiscount(value: string | null): number | null {
    const match = value?.match(/(\d{1,3})\s*%/);
    return match ? Number.parseInt(match[1], 10) : null;
}

function parseRating(value: string | null): number | null {
    if (!value) return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 5 ? parsed : null;
}

function parseOrders(value: string | null): number | null {
    if (!value) return null;
    const match = value.replace(/,/g, '').match(/([\d.]+)\s*([km])?/i);
    if (!match) return null;
    let count = Number.parseFloat(match[1]);
    if (!Number.isFinite(count)) return null;
    if (match[2]?.toLowerCase() === 'k') count *= 1_000;
    if (match[2]?.toLowerCase() === 'm') count *= 1_000_000;
    return Math.round(count);
}

function currencyFrom(value: string | null): string {
    if (!value) return 'USD';
    if (value.includes('€')) return 'EUR';
    if (value.includes('£')) return 'GBP';
    if (value.includes('₹')) return 'INR';
    if (value.includes('CA$')) return 'CAD';
    if (value.includes('AU$')) return 'AUD';
    return 'USD';
}

function normalizeUrl(value: string | null): string | null {
    if (!value) return null;
    if (value.startsWith('//')) return `https:${value}`;
    return value;
}

function productIdFromUrl(value: string): string | null {
    return value.match(/\/item\/(\d+)\.html/i)?.[1] ?? null;
}

export async function scrollSearchResults(page: Page): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight * 1.8, 1200)));
        await page.waitForTimeout(900 + Math.floor(Math.random() * 700));
    }
    await page.evaluate(() => window.scrollTo(0, 0));
}

export async function isBlockedPage(page: Page): Promise<boolean> {
    const state = await page.evaluate(() => ({
        title: document.title,
        body: document.body?.innerText?.slice(0, 15_000) ?? '',
    }));
    return /captcha|robot|security verification|unusual traffic|access denied|punish/i.test(`${state.title}\n${state.body}`);
}

export async function extractProducts(
    page: Page,
    searchQuery: string,
    pageNumber: number,
): Promise<ProductRecord[]> {
    const rawProducts = await page.evaluate((): RawProduct[] => {
        const anchors = [...document.querySelectorAll<HTMLAnchorElement>('a.search-card-item[href*="/item/"]')];
        return anchors.map((card) => {
            const title = card.querySelector('h3')?.textContent?.trim()
                || card.querySelector<HTMLElement>('[role="heading"]')?.getAttribute('aria-label')
                || card.querySelector<HTMLImageElement>('img[alt]')?.alt
                || '';

            const priceRoot = [...card.querySelectorAll<HTMLElement>('[aria-label]')]
                .find((element) => /(?:US\s*)?[$€£₹]\s*\d|\d[.,]\d/.test(element.getAttribute('aria-label') ?? ''));
            const strictPriceRoot = [...card.querySelectorAll<HTMLElement>('[aria-label]')]
                .find((element) => /^(?:US\s*)?(?:CA\$|AU\$|[$\u20ac\u00a3\u20b9])\s*\d/i
                    .test(element.getAttribute('aria-label')?.trim() ?? ''));
            const originalPrice = card.querySelector<HTMLElement>('[style*="line-through"]')?.textContent?.trim() ?? null;
            const discount = [...card.querySelectorAll<HTMLElement>('span')]
                .map((element) => element.textContent?.trim() ?? '')
                .find((text) => /^-?\s*\d{1,3}%$/.test(text)) ?? null;
            const rating = [...card.querySelectorAll<HTMLElement>('span')]
                .find((element) => {
                    const text = element.textContent?.trim() ?? '';
                    const nearby = element.parentElement?.parentElement?.textContent ?? '';
                    return /^[1-5](?:\.\d{1,2})?$/.test(text) && /sold/i.test(nearby);
                })?.textContent?.trim() ?? null;
            const orders = [...card.querySelectorAll<HTMLElement>('span')]
                .map((element) => element.textContent?.trim() ?? '')
                .find((text) => /sold/i.test(text)) ?? null;
            const storeName = card.querySelector<HTMLElement>(
                '[data-spm*="store"], [class*="store-name"], [class*="shop-name"]',
            )?.textContent?.trim() ?? null;
            const image = [...card.querySelectorAll<HTMLImageElement>('img[src]')]
                .find((candidate) => candidate.alt?.trim() === title || /aliexpress-media|alicdn/i.test(candidate.src));

            return {
                href: card.href,
                title,
                priceText: strictPriceRoot?.getAttribute('aria-label')
                    ?? strictPriceRoot?.textContent?.trim()
                    ?? null,
                originalPriceText: originalPrice,
                discountText: discount,
                ratingText: rating,
                ordersText: orders,
                storeName,
                imageUrl: image?.src ?? null,
            };
        });
    });

    const records: ProductRecord[] = [];
    for (const [index, raw] of rawProducts.entries()) {
        const productId = productIdFromUrl(raw.href);
        const price = parseMoney(raw.priceText);
        const originalPrice = parseMoney(raw.originalPriceText);
        const discountPercent = parseDiscount(raw.discountText);
        const title = redactSensitiveText(raw.title);
        if (!productId || !title || price === null) continue;
        if (originalPrice !== null && discountPercent !== null && discountPercent > 0 && price >= originalPrice) continue;

        records.push({
            searchQuery,
            position: ((pageNumber - 1) * Math.max(rawProducts.length, 1)) + index + 1,
            productId,
            title,
            price,
            originalPrice,
            discountPercent,
            currency: currencyFrom(raw.priceText),
            rating: parseRating(raw.ratingText),
            ordersCount: parseOrders(raw.ordersText),
            storeName: raw.storeName ? redactSensitiveText(raw.storeName) : null,
            imageUrl: normalizeUrl(raw.imageUrl),
            productUrl: `https://www.aliexpress.com/item/${productId}.html`,
            scrapedAt: new Date().toISOString(),
        });
    }

    return records;
}
