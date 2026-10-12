// Developer-authored fictitious fixtures. No data from AliExpress or customer runs.
export const QA_NOW = new Date('2026-10-12T12:00:00Z');
export const QA_OBSERVATION: Record<string, unknown> = {
    productId: '00000001', title: 'Owner synthetic cable A', variant: '1 m / black', observedAt: '2026-10-10',
    currency: 'USD', shipToCountry: 'US', priceBasis: 'standard', taxBasis: 'excluded', quantityBasis: 'per-unit',
    comparisonGroup: 'Owner QA comparison', price: 4, mrp: 8, discountPercent: 50,
    shippingCost: 2, taxCost: 0.5, dutyCost: 0, rating: 4.6, soldCount: 1000, soldCountBasis: 'lower-bound',
    deliveryDaysMin: 5, deliveryDaysMax: 10, inStock: true,
};
export const QA_NEXT: Record<string, unknown> = { ...QA_OBSERVATION, observedAt: '2026-10-11', price: 5, shippingCost: 3,
    discountPercent: 37.5, deliveryDaysMax: 15, inStock: false };
export const QA_PEER: Record<string, unknown> = { ...QA_OBSERVATION, productId: '00000002', title: 'Owner synthetic cable B', price: 3, mrp: 6 };
export function importInput(rows: unknown[] = [QA_OBSERVATION], options: Record<string, unknown> = {}): Record<string, unknown> {
    return { mode: 'import', authorizedData: true, importSource: 'Synthetic owner QA — not live AliExpress data',
        importJson: JSON.stringify(rows), maxResults: 500, ...options };
}
