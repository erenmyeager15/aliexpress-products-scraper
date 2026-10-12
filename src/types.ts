export type Mode = 'demo' | 'import';
export type PriceBasis = 'standard' | 'new-customer' | 'conditional' | 'unknown';
export type TaxBasis = 'included' | 'excluded' | 'unknown';
export type QuantityBasis = 'per-unit' | 'per-order' | 'unknown';

export interface ScenarioOptions {
    retailPriceUsd: number | null;
    marketplaceFeePercent: number;
    paymentFeePercent: number;
    returnsReservePercent: number;
    fixedFeeUsd: number;
    fulfillmentCostUsd: number;
    adCostUsd: number;
    targetContributionMarginPercent: number;
    priceChangeThresholdPercent: number;
    landedCostRiseThresholdPercent: number;
    deliveryIncreaseThresholdDays: number;
    comparisonWindowDays: number;
}

export interface NormalizedInput {
    mode: Mode;
    demoPreset: 'us-cost-comparison' | 'us-margin-scenario' | 'us-price-change-review';
    maxResults: number;
    scenario: ScenarioOptions;
}

export interface ProductObservation {
    productId: string;
    title: string;
    variant: string | null;
    observedAt: string;
    currency: string | null;
    shipToCountry: string | null;
    priceBasis: PriceBasis;
    taxBasis: TaxBasis;
    quantityBasis: QuantityBasis;
    comparisonGroup: string | null;
    price: number;
    mrp: number | null;
    statedDiscountPercent: number | null;
    calculatedDiscountPercent: number | null;
    shippingCost: number | null;
    taxCost: number | null;
    dutyCost: number | null;
    rating: number | null;
    ratingCount: number | null;
    soldCount: number | null;
    soldCountBasis: 'exact' | 'lower-bound' | 'unknown';
    deliveryDaysMin: number | null;
    deliveryDaysMax: number | null;
    inStock: boolean | null;
    productUrl: string | null;
    imageUrl: string | null;
    brand: string | null;
    category: string | null;
}

export interface ProductAnalysis {
    recordType: 'authorized-product-analysis' | 'synthetic-product-preview';
    source: 'user-authorized-import' | 'synthetic-demo';
    marketplace: 'aliexpress';
    isSynthetic: boolean;
    productId: string;
    title: string;
    productUrl: string | null;
    dataProvider: string;
    importedAt: string;
    observationCount: number;
    observations: ProductObservation[];
}

export interface ImportPlan {
    records: ProductAnalysis[];
    inputRowCount: number;
    normalizedObservationCount: number;
    duplicateObservationsRemoved: number;
    inputProductCount: number;
    selectedProductCount: number;
    omittedProductCount: number;
    unsupportedColumnsDropped: number;
    dataProvider: string;
}

export interface ChargeResultLike {
    chargedCount: number;
    eventChargeLimitReached: boolean;
}
