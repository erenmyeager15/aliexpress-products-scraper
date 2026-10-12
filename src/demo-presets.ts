import { InputError, inputObject } from './input.js';
import type { NormalizedInput } from './types.js';

const base = { productId: '00000001', title: 'SYNTHETIC USB-C cable A', variant: '1 m / black', observedAt: '2026-10-10',
    currency: 'USD', shipToCountry: 'US', priceBasis: 'standard', taxBasis: 'excluded', quantityBasis: 'per-unit',
    comparisonGroup: 'Synthetic cable comparison', price: 4, shippingCost: 2, taxCost: 0.5, dutyCost: 0,
    mrp: 8, discountPercent: 50, rating: 4.6, soldCount: 1000, soldCountBasis: 'lower-bound',
    deliveryDaysMin: 5, deliveryDaysMax: 10, inStock: true };

export function demoRows(preset: NormalizedInput['demoPreset']): Record<string, unknown>[] {
    if (preset === 'us-cost-comparison') return [
        { ...base },
        { ...base, productId: '00000002', title: 'SYNTHETIC USB-C cable B', price: 3, shippingCost: null, taxCost: null, dutyCost: null },
        { ...base, productId: '00000003', title: 'SYNTHETIC new-customer offer', price: 0.99, priceBasis: 'new-customer', mrp: null, discountPercent: null },
    ];
    if (preset === 'us-margin-scenario') return [
        { ...base },
        { ...base, productId: '00000002', title: 'SYNTHETIC higher-cost cable', price: 12, shippingCost: 4, taxCost: 1, dutyCost: 1, mrp: 20, discountPercent: 40 },
    ];
    if (preset === 'us-price-change-review') return [
        { ...base },
        { ...base, observedAt: '2026-10-11', price: 5, shippingCost: 3, discountPercent: 37.5, deliveryDaysMax: 15, inStock: false },
        { ...base, productId: '00000002', title: 'SYNTHETIC offer basis drift', price: 0.99, priceBasis: 'new-customer', mrp: null, discountPercent: null },
        { ...base, productId: '00000002', title: 'SYNTHETIC offer basis drift', observedAt: '2026-10-11', price: 4 },
    ];
    throw new InputError('Unknown synthetic demo preset.');
}

export function assertDemoInput(input: unknown): void {
    const object = inputObject(input);
    if (['importJson', 'importCsv', 'importSource'].some((key) => object[key] !== undefined && object[key] !== null && object[key] !== '')) {
        throw new InputError('Demo uses fixed synthetic data only. Remove import fields or select import to analyze your authorized observations.');
    }
}
