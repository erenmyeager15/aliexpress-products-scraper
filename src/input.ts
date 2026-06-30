import type { ActorInput, NormalizedInput, ProxyInput } from './types.js';

export const DEFAULT_SEARCH_QUERIES = ['wireless earbuds'];
export const DEFAULT_MAX_RESULTS = 1;
export const DEFAULT_MAX_PAGES_PER_QUERY = 1;
export const DEFAULT_PROXY_CONFIGURATION: ProxyInput = {
    useApifyProxy: true,
    apifyProxyGroups: ['RESIDENTIAL'],
    apifyProxyCountry: 'US',
};

export function normalizeInput(input: ActorInput = {}): NormalizedInput {
    const hasSearchQueries = Object.prototype.hasOwnProperty.call(input, 'searchQueries');
    const rawQueries = hasSearchQueries && Array.isArray(input.searchQueries)
        ? input.searchQueries
        : DEFAULT_SEARCH_QUERIES;
    const searchQueries = [...new Set(rawQueries.map((query) => cleanText(query)).filter(Boolean))].slice(0, 25);

    if (searchQueries.length === 0) {
        throw new Error('Provide at least one non-empty search query.');
    }

    return {
        searchQueries,
        maxResults: clampInteger(input.maxResults, DEFAULT_MAX_RESULTS, 1, 500),
        maxPagesPerQuery: clampInteger(input.maxPagesPerQuery, DEFAULT_MAX_PAGES_PER_QUERY, 1, 10),
        proxyConfiguration: input.proxyConfiguration ?? DEFAULT_PROXY_CONFIGURATION,
    };
}

function clampInteger(value: unknown, defaultValue: number, minimum: number, maximum: number): number {
    const numericValue = Number(value ?? defaultValue);
    const safeValue = Number.isFinite(numericValue) ? Math.floor(numericValue) : defaultValue;
    return Math.min(Math.max(safeValue, minimum), maximum);
}

function cleanText(value: unknown): string {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}
