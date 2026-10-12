import type { ChargeResultLike } from './types.js';

export const PRODUCT_EVENT = 'product-scraped';
export interface ProductChargingManager {
    getPricingInfo(): { isPayPerEvent: boolean; perEventPrices: Record<string, number> };
    getChargedEventCount(eventName: string): number;
    calculateMaxEventChargeCountWithinLimit(eventName: string): number;
}
export interface ProductSavePorts<T> {
    manager: ProductChargingManager;
    push(record: T, eventName: string): Promise<ChargeResultLike>;
}

export class BillingAcknowledgmentError extends Error { readonly code = 'BILLING_ACKNOWLEDGMENT_FAILED'; }

/** Actor.pushData chargedCount can aggregate custom AND synthetic acknowledgments.
 * Normalize to the confirmed custom product counter delta, never to total events.
 * No extra charge call, retry, dataset write or remote lookup is performed here.
 */
export async function saveConfirmedProduct<T>(record: T, ports: ProductSavePorts<T>): Promise<ChargeResultLike> {
    const { manager } = ports;
    const pricing = manager.getPricingInfo();
    if (pricing.isPayPerEvent && (!Number.isFinite(pricing.perEventPrices[PRODUCT_EVENT]) || pricing.perEventPrices[PRODUCT_EVENT] <= 0)) {
        throw new BillingAcknowledgmentError('Product-result pricing is unavailable; no product write was attempted.');
    }
    if ((pricing.perEventPrices['apify-default-dataset-item'] ?? 0) > 0) {
        throw new BillingAcknowledgmentError('Unexpected additional dataset-result pricing; no product write was attempted.');
    }
    const before = manager.getChargedEventCount(PRODUCT_EVENT);
    if (!Number.isSafeInteger(before) || before < 0) throw new BillingAcknowledgmentError('Product counter is unavailable; no product write was attempted.');
    const acknowledgment = await ports.push(record, PRODUCT_EVENT);
    if (!acknowledgment || !Number.isSafeInteger(acknowledgment.chargedCount) || acknowledgment.chargedCount < 0
        || typeof acknowledgment.eventChargeLimitReached !== 'boolean') {
        throw new BillingAcknowledgmentError('Product write acknowledgment is unavailable; no retry was attempted.');
    }
    const after = manager.getChargedEventCount(PRODUCT_EVENT);
    const customCount = after - before;
    if (!Number.isSafeInteger(after) || after < 0 || ![0, 1].includes(customCount) || acknowledgment.chargedCount < customCount) {
        throw new BillingAcknowledgmentError('Product event acknowledgment is inconsistent; no retry was attempted.');
    }
    const productLimitReached = manager.calculateMaxEventChargeCountWithinLimit(PRODUCT_EVENT) <= 0;
    if (pricing.isPayPerEvent && customCount === 0 && !productLimitReached) {
        throw new BillingAcknowledgmentError('Product write lacks a confirmed custom event; no retry was attempted.');
    }
    return { chargedCount: customCount, eventChargeLimitReached: pricing.isPayPerEvent ? productLimitReached : acknowledgment.eventChargeLimitReached };
}
