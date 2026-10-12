import { Buffer } from 'node:buffer';
import { InputError, inputObject, normalizeInput } from './input.js';
import { parseNumber, redactSensitiveText, round, safeImageUrl, safeProductUrl } from './routes.js';
import type { ImportPlan, ProductAnalysis, ProductObservation } from './types.js';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 1000;
type Row = Record<string, unknown>;
const ALIASES: Record<string, keyof ProductObservation> = {
    productid: 'productId', id: 'productId', title: 'title', name: 'title', producttitle: 'title',
    variant: 'variant', variantlabel: 'variant', sku: 'variant',
    observedat: 'observedAt', scrapedat: 'observedAt', date: 'observedAt',
    currency: 'currency', shiptocountry: 'shipToCountry', shipto: 'shipToCountry',
    pricebasis: 'priceBasis', taxbasis: 'taxBasis', quantitybasis: 'quantityBasis',
    comparisongroup: 'comparisonGroup', price: 'price', saleprice: 'price', pricecurrent: 'price',
    mrp: 'mrp', originalprice: 'mrp', priceoriginal: 'mrp',
    stateddiscountpercent: 'statedDiscountPercent', discountpercent: 'statedDiscountPercent', pricediscount: 'statedDiscountPercent',
    shippingcost: 'shippingCost', shippingfee: 'shippingCost', taxcost: 'taxCost', dutycost: 'dutyCost',
    rating: 'rating', ratingvalue: 'rating', ratingcount: 'ratingCount',
    soldcount: 'soldCount', orderscount: 'soldCount', soldcountbasis: 'soldCountBasis',
    deliverydaysmin: 'deliveryDaysMin', deliverydaysmax: 'deliveryDaysMax', instock: 'inStock',
    producturl: 'productUrl', url: 'productUrl', imageurl: 'imageUrl', brand: 'brand', category: 'category',
};
const keyOf = (header: string): string => header.toLowerCase().replace(/[^a-z0-9]/g, '');
const alias = (header: string): keyof ProductObservation | undefined => Object.hasOwn(ALIASES, keyOf(header)) ? ALIASES[keyOf(header)] : undefined;
const missing = (value: unknown): boolean => value === undefined || value === null
    || (typeof value === 'string' && /^(?:\s*|n\/?a|null|unknown|--?)$/i.test(value.trim()));
function fail(row: number, message: string): never { throw new InputError(`Import row ${row}: ${message}`, 'INVALID_IMPORT'); }

/** Bounded quoted CSV, no file references, network fetches, ZIPs or formula evaluation. */
export function parseCsv(text: string): Row[] {
    if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) throw new InputError('CSV exceeds 2 MiB.', 'INVALID_IMPORT');
    if (text.includes('\0')) throw new InputError('CSV contains an unsupported null character.', 'INVALID_IMPORT');
    text = text.replace(/^\uFEFF/, '');
    const rows: string[][] = [];
    let row: string[] = [], cell = '', quoted = false, closed = false;
    const pushRow = (): void => {
        row.push(cell);
        if (row.some((value) => value.trim() !== '')) rows.push(row);
        if (rows.length > MAX_IMPORT_ROWS + 1) throw new InputError('CSV exceeds 1,000 observations.', 'INVALID_IMPORT');
        row = []; cell = ''; closed = false;
    };
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (quoted) {
            if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
            else if (char === '"') { quoted = false; closed = true; }
            else cell += char;
        } else if (char === ',') {
            row.push(cell); cell = ''; closed = false;
            if (row.length >= 60) throw new InputError('CSV exceeds 60 columns.', 'INVALID_IMPORT');
        } else if (char === '\r' || char === '\n') {
            if (char === '\r' && text[index + 1] === '\n') index += 1;
            pushRow();
        } else if (char === '"') {
            if (cell !== '' || closed) throw new InputError('CSV contains a misplaced quote.', 'INVALID_IMPORT');
            quoted = true;
        } else if (closed) {
            if (char !== ' ' && char !== '\t') throw new InputError('CSV contains text after a closing quote.', 'INVALID_IMPORT');
        } else cell += char;
    }
    if (quoted) throw new InputError('CSV contains an unclosed quoted field.', 'INVALID_IMPORT');
    if (cell !== '' || row.length || closed) pushRow();
    if (rows.length < 2) throw new InputError('CSV needs a header and an observation.', 'INVALID_IMPORT');
    const headers = rows.shift()!;
    if (headers.length > 60 || headers.some((header) => !header.trim() || header.length > 100)) {
        throw new InputError('CSV needs nonempty headers, maximum 60 columns and 100 characters per header.', 'INVALID_IMPORT');
    }
    const normalized = headers.map((header) => alias(header) ?? keyOf(header));
    if (new Set(normalized).size !== normalized.length) throw new InputError('CSV has duplicate or ambiguous headers.', 'INVALID_IMPORT');
    return rows.map((values, index) => {
        if (values.length !== headers.length) fail(index + 1, 'column count does not match the header.');
        return Object.fromEntries(headers.map((header, position) => [header, values[position]]));
    });
}

function canonical(raw: unknown, row: number, dropped: Set<string>): Row {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(row, 'expected an object.');
    const entries = Object.entries(raw);
    if (entries.length > 60) fail(row, 'maximum 60 columns.');
    const value: Row = Object.create(null) as Row;
    for (const [key, item] of entries) {
        const field = alias(key);
        if (!field) { dropped.add(keyOf(key)); continue; }
        if (Object.hasOwn(value, field)) fail(row, 'multiple columns map to the same field.');
        value[field] = item;
    }
    return value;
}

function text(value: unknown, row: number, field: string, limit: number, required = false): string | null {
    if (missing(value)) { if (required) fail(row, `${field} is required.`); return null; }
    if (typeof value !== 'string' || value.length > limit) fail(row, `${field} must be text, maximum ${limit} characters.`);
    const clean = redactSensitiveText(value);
    if (!clean && required) fail(row, `${field} is required.`);
    return clean || null;
}

function numeric(row: Row, index: number, field: string, max = 1_000_000_000, integer = false, required = false): number | null {
    if (missing(row[field])) { if (required) fail(index, `${field} is required.`); return null; }
    const value = parseNumber(row[field], 0, max, integer);
    if (value === null) fail(index, `${field} must be ${integer ? 'a whole' : 'a'} nonnegative numeric value, maximum ${max}. Use unambiguous numbers, not currency labels, ranges, shorthand or formulae.`);
    return value;
}

function option<T extends string>(value: unknown, row: number, field: string, allowed: readonly T[], fallback: T): T {
    if (missing(value)) return fallback;
    if (typeof value !== 'string' || !allowed.includes(value.trim().toLowerCase() as T)) fail(row, `invalid ${field}.`);
    return value.trim().toLowerCase() as T;
}

function code(value: unknown, row: number, field: string, length: number): string | null {
    if (missing(value)) return null;
    if (typeof value !== 'string' || !(new RegExp(`^[A-Za-z]{${length}}$`)).test(value.trim())) fail(row, `${field} must be a ${length}-letter code or empty.`);
    return value.trim().toUpperCase();
}

function timestamp(value: unknown, row: number, now: Date): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value)) {
        fail(row, 'observedAt is required as YYYY-MM-DD or a UTC ISO timestamp ending in Z.');
    }
    const dateOnly = value.length === 10;
    const parsed = new Date(dateOnly ? `${value}T00:00:00Z` : value);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value.slice(0, 10)
        || (!dateOnly && parsed.toISOString().slice(11, 19) !== value.slice(11, 19))) {
        fail(row, 'observedAt contains an impossible date or time.');
    }
    if (parsed.getTime() > now.getTime()) fail(row, 'observedAt cannot be in the future.');
    return parsed.toISOString();
}

export function observationScope(item: ProductObservation): string {
    return JSON.stringify([item.productId, item.variant, item.currency, item.shipToCountry, item.priceBasis, item.taxBasis, item.quantityBasis]);
}

function normalizeObservation(raw: unknown, row: number, dropped: Set<string>, now: Date): ProductObservation {
    const data = canonical(raw, row, dropped);
    if (typeof data.productId !== 'string' || !/^\d{8,24}$/.test(data.productId.trim())) {
        fail(row, 'productId must be an 8–24 digit STRING, preserving large identifiers exactly.');
    }
    const productId = data.productId.trim();
    const taxBasis = option(data.taxBasis, row, 'taxBasis', ['included', 'excluded', 'unknown'], 'unknown');
    const taxCost = numeric(data, row, 'taxCost');
    if (taxBasis === 'included' && taxCost !== null && taxCost !== 0) fail(row, 'taxCost must be 0 when taxBasis is included; do not add included tax again.');
    let inStock: boolean | null = null;
    if (!missing(data.inStock)) {
        if (typeof data.inStock === 'boolean') inStock = data.inStock;
        else if (typeof data.inStock === 'string' && /^(true|false)$/i.test(data.inStock.trim())) inStock = data.inStock.trim().toLowerCase() === 'true';
        else fail(row, 'inStock must be true, false or empty; zero/one is not inferred.');
    }
    const productUrl = safeProductUrl(data.productUrl, productId);
    if (!missing(data.productUrl) && productUrl === null) fail(row, 'productUrl must be an AliExpress HTTP(S) item URL matching productId, without credentials or a custom port.');
    const imageUrl = safeImageUrl(data.imageUrl);
    if (!missing(data.imageUrl) && imageUrl === null) fail(row, 'imageUrl must be an AliExpress media/alicdn HTTP(S) URL without credentials or a custom port.');
    const deliveryDaysMin = numeric(data, row, 'deliveryDaysMin', 3650, true);
    const deliveryDaysMax = numeric(data, row, 'deliveryDaysMax', 3650, true);
    if (deliveryDaysMin !== null && deliveryDaysMax !== null && deliveryDaysMin > deliveryDaysMax) fail(row, 'deliveryDaysMin exceeds deliveryDaysMax.');
    const price = numeric(data, row, 'price', 1_000_000_000, false, true)!;
    const mrp = numeric(data, row, 'mrp');
    return {
        productId, title: text(data.title, row, 'title', 500, true)!,
        variant: text(data.variant, row, 'variant', 160), observedAt: timestamp(data.observedAt, row, now),
        currency: code(data.currency, row, 'currency', 3), shipToCountry: code(data.shipToCountry, row, 'shipToCountry', 2),
        priceBasis: option(data.priceBasis, row, 'priceBasis', ['standard', 'new-customer', 'conditional', 'unknown'], 'unknown'),
        taxBasis, quantityBasis: option(data.quantityBasis, row, 'quantityBasis', ['per-unit', 'per-order', 'unknown'], 'unknown'),
        comparisonGroup: text(data.comparisonGroup, row, 'comparisonGroup', 160),
        price, mrp, statedDiscountPercent: numeric(data, row, 'statedDiscountPercent', 100),
        calculatedDiscountPercent: mrp !== null && mrp > 0 ? round((mrp - price) / mrp * 100) : null,
        shippingCost: numeric(data, row, 'shippingCost'), taxCost, dutyCost: numeric(data, row, 'dutyCost'),
        rating: numeric(data, row, 'rating', 5), ratingCount: numeric(data, row, 'ratingCount', 1_000_000_000, true),
        soldCount: numeric(data, row, 'soldCount', 1_000_000_000, true),
        soldCountBasis: option(data.soldCountBasis, row, 'soldCountBasis', ['exact', 'lower-bound', 'unknown'], 'unknown'),
        deliveryDaysMin, deliveryDaysMax, inStock, productUrl, imageUrl,
        brand: text(data.brand, row, 'brand', 160), category: text(data.category, row, 'category', 200),
    };
}

export function prepareImport(input: unknown, now = new Date()): ImportPlan {
    const object = inputObject(input);
    const normalized = normalizeInput(object);
    if (normalized.mode !== 'import') throw new InputError('Select import to analyze a real authorized export.', 'INVALID_IMPORT');
    if (object.authorizedData !== true) throw new InputError('Confirm authorizedData true only if you have the right to process these observations through this paid service. This declaration does not grant source permissions.', 'RIGHTS_CONFIRMATION_REQUIRED');
    if (typeof object.importSource !== 'string' || !object.importSource.trim() || object.importSource.length > 160) {
        throw new InputError('Provide importSource: your export provider/source label, maximum 160 characters.', 'INVALID_IMPORT');
    }
    const dataProvider = redactSensitiveText(object.importSource);
    const sources = ['importJson', 'importCsv'].filter((key) => object[key] !== undefined && object[key] !== null && object[key] !== '');
    if (sources.length !== 1) throw new InputError('Provide exactly one nonempty importJson string or importCsv string. No URLs or files are fetched.', 'INVALID_IMPORT');
    const body = object[sources[0]];
    if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > MAX_IMPORT_BYTES) {
        throw new InputError('The pasted export must be text, maximum 2 MiB.', 'INVALID_IMPORT');
    }
    let rows: unknown;
    if (sources[0] === 'importCsv') rows = parseCsv(body);
    else {
        try { rows = JSON.parse(body); }
        catch { throw new InputError('importJson must be valid JSON containing an array of observation objects.', 'INVALID_IMPORT'); }
    }
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_IMPORT_ROWS) {
        throw new InputError('Supply an array of 1–1,000 observation objects.', 'INVALID_IMPORT');
    }
    if (!Number.isFinite(now.getTime())) throw new InputError('Invalid import clock.', 'INVALID_IMPORT');
    const dropped = new Set<string>(), seen = new Map<string, string>(), grouped = new Map<string, ProductObservation[]>();
    let duplicates = 0, observationCount = 0;
    for (const [index, raw] of rows.entries()) {
        const item = normalizeObservation(raw, index + 1, dropped, now);
        const key = `${observationScope(item)}:${item.observedAt}`;
        const fingerprint = JSON.stringify(item);
        if (seen.has(key)) {
            if (seen.get(key) !== fingerprint) fail(index + 1, 'conflicting observations for the same product/time/context. Correct the export before saving.');
            duplicates += 1; continue;
        }
        seen.set(key, fingerprint); observationCount += 1;
        const observations = grouped.get(item.productId) ?? [];
        observations.push(item); grouped.set(item.productId, observations);
    }
    const selected = [...grouped.entries()].slice(0, normalized.maxResults);
    const records: ProductAnalysis[] = selected.map(([productId, observations]) => {
        observations.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
        const latest = observations.at(-1)!;
        return { recordType: 'authorized-product-analysis', source: 'user-authorized-import', marketplace: 'aliexpress', isSynthetic: false,
            productId, title: latest.title, productUrl: latest.productUrl, dataProvider, importedAt: now.toISOString(),
            observationCount: observations.length, observations };
    });
    return { records, inputRowCount: rows.length, normalizedObservationCount: observationCount, duplicateObservationsRemoved: duplicates,
        inputProductCount: grouped.size, selectedProductCount: records.length, omittedProductCount: grouped.size - records.length,
        unsupportedColumnsDropped: dropped.size, dataProvider };
}
