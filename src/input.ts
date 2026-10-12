import type { Mode, NormalizedInput, ScenarioOptions } from './types.js';
import { exactSum } from './decimal.js';

export class InputError extends Error {
    constructor(message: string, readonly code = 'INVALID_INPUT') { super(message); }
}

export function inputObject(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Input must be a JSON object.');
    return input as Record<string, unknown>;
}

export function selectMode(input: unknown): Mode {
    const object = inputObject(input);
    const legacy = ['searchQueries', 'searchQuery', 'startUrls', 'productUrls', 'maxPagesPerQuery', 'proxyConfiguration'];
    if (legacy.some((field) => Object.hasOwn(object, field))) {
        throw new InputError('Live AliExpress collection is retired in this redesign. Remove search/URL/proxy inputs and choose demo for a synthetic preview, or import for your authorized CSV/JSON export. No AliExpress lookup or product-result charge was performed.', 'LEGACY_INPUT_RETIRED');
    }
    if (object.mode !== 'demo' && object.mode !== 'import') {
        throw new InputError('Select mode demo or import explicitly. Demo is synthetic; import requires an authorized CSV/JSON export. This Actor does not fetch live AliExpress products.');
    }
    return object.mode;
}

export function numberOption(object: Record<string, unknown>, key: string, fallback: number, maximum: number, integer = false, minimum = 0): number {
    const value = object[key] === undefined ? fallback : object[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
        throw new InputError(`${key} must be ${integer ? 'an integer' : 'a number'} between ${minimum} and ${maximum}.`);
    }
    return value;
}

export function scenarioOptions(input: unknown): ScenarioOptions {
    const object = inputObject(input);
    const retailPriceUsd = object.retailPriceUsd === undefined || object.retailPriceUsd === null
        ? null : numberOption(object, 'retailPriceUsd', 0, 1_000_000, false, 0.01);
    const marketplaceFeePercent = numberOption(object, 'marketplaceFeePercent', 0, 99);
    const paymentFeePercent = numberOption(object, 'paymentFeePercent', 0, 99);
    const returnsReservePercent = numberOption(object, 'returnsReservePercent', 0, 99);
    if (exactSum(marketplaceFeePercent, paymentFeePercent, returnsReservePercent) >= 100) {
        throw new InputError('Combined marketplace, payment and returns-reserve percentages must be below 100.');
    }
    return {
        retailPriceUsd, marketplaceFeePercent, paymentFeePercent, returnsReservePercent,
        fixedFeeUsd: numberOption(object, 'fixedFeeUsd', 0, 1_000_000),
        fulfillmentCostUsd: numberOption(object, 'fulfillmentCostUsd', 0, 1_000_000),
        adCostUsd: numberOption(object, 'adCostUsd', 0, 1_000_000),
        targetContributionMarginPercent: numberOption(object, 'targetContributionMarginPercent', 25, 95),
        priceChangeThresholdPercent: numberOption(object, 'priceChangeThresholdPercent', 5, 1000, false, 0.01),
        landedCostRiseThresholdPercent: numberOption(object, 'landedCostRiseThresholdPercent', 10, 1000, false, 0.01),
        deliveryIncreaseThresholdDays: numberOption(object, 'deliveryIncreaseThresholdDays', 3, 3650, true, 1),
        comparisonWindowDays: numberOption(object, 'comparisonWindowDays', 30, 3650, true, 1),
    };
}

export function normalizeInput(input: unknown): NormalizedInput {
    const object = inputObject(input);
    const mode = selectMode(object);
    const demoPreset = object.demoPreset ?? 'us-cost-comparison';
    if (typeof demoPreset !== 'string' || !['us-cost-comparison', 'us-margin-scenario', 'us-price-change-review'].includes(demoPreset)) {
        throw new InputError('Unknown demo preset. Choose one of the three labeled US synthetic previews.');
    }
    return {
        mode, demoPreset: demoPreset as NormalizedInput['demoPreset'],
        maxResults: numberOption(object, 'maxResults', 1, 500, true, 1), scenario: scenarioOptions(object),
    };
}
