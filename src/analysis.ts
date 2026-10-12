import type { ProductAnalysis, ProductObservation, ScenarioOptions } from './types.js';
import { observationScope } from './importer.js';
import { csvCell, markdownText, round } from './routes.js';
import { changeMeetsThreshold, contributionMeetsTarget, exactSum } from './decimal.js';

export interface CostCheck { enteredLandedCost: number | null; missing: string[]; }
export function costCheck(item: ProductObservation): CostCheck {
    const missing: string[] = [];
    if (!item.currency) missing.push('currency');
    if (!item.shipToCountry) missing.push('shipToCountry');
    if (item.quantityBasis !== 'per-unit') missing.push('per-unit quantity basis');
    if (item.priceBasis === 'unknown') missing.push('priceBasis');
    if (item.taxBasis === 'unknown') missing.push('taxBasis');
    for (const field of ['shippingCost', 'taxCost', 'dutyCost'] as const) if (item[field] === null) missing.push(field);
    return { enteredLandedCost: missing.length ? null : exactSum(item.price, item.shippingCost!, item.taxCost!, item.dutyCost!), missing };
}

function hasComparisonContext(item: ProductObservation): boolean {
    return item.variant !== null && item.currency !== null && item.shipToCountry !== null
        && item.priceBasis === 'standard' && item.taxBasis !== 'unknown' && item.quantityBasis === 'per-unit';
}

export interface ContributionScenario {
    status: 'not_requested' | 'incomplete_costs' | 'non_us_usd_scope' | 'non_standard_offer' | 'calculated';
    contributionUsd: number | null;
    contributionMarginPercent: number | null;
    breakEvenRetailUsd: number | null;
    maxAdSpendForTargetUsd: number | null;
    meetsTarget: boolean | null;
}
export function contributionScenario(item: ProductObservation, options: ScenarioOptions): ContributionScenario {
    const empty = (status: ContributionScenario['status']): ContributionScenario => ({ status, contributionUsd: null,
        contributionMarginPercent: null, breakEvenRetailUsd: null, maxAdSpendForTargetUsd: null, meetsTarget: null });
    if (options.retailPriceUsd === null) return empty('not_requested');
    if (item.currency !== 'USD' || item.shipToCountry !== 'US') return empty('non_us_usd_scope');
    if (item.priceBasis !== 'standard') return empty('non_standard_offer');
    const costs = costCheck(item);
    if (costs.enteredLandedCost === null) return empty('incomplete_costs');
    const percentage = exactSum(options.marketplaceFeePercent, options.paymentFeePercent, options.returnsReservePercent) / 100;
    const retail = options.retailPriceUsd;
    const fixed = options.fixedFeeUsd + options.fulfillmentCostUsd;
    const contribution = retail * (1 - percentage) - costs.enteredLandedCost - fixed - options.adCostUsd;
    const margin = contribution / retail * 100;
    return { status: 'calculated', contributionUsd: round(contribution), contributionMarginPercent: round(margin),
        breakEvenRetailUsd: round((costs.enteredLandedCost + fixed + options.adCostUsd) / (1 - percentage)),
        maxAdSpendForTargetUsd: round(retail * (1 - percentage - options.targetContributionMarginPercent / 100) - costs.enteredLandedCost - fixed),
        meetsTarget: contributionMeetsTarget(retail, [costs.enteredLandedCost, options.fixedFeeUsd, options.fulfillmentCostUsd, options.adCostUsd],
            [options.marketplaceFeePercent, options.paymentFeePercent, options.returnsReservePercent], options.targetContributionMarginPercent) };
}

export interface Finding {
    type: 'price_changed' | 'entered_cost_increased' | 'delivery_slower' | 'supplied_stock_out' | 'offer_context_changed';
    productId: string;
    variant: string | null;
    previousObservedAt: string;
    observedAt: string;
    currency: string | null;
    shipToCountry: string | null;
    previousValue: number | boolean | string;
    currentValue: number | boolean | string;
    change: number | null;
    threshold: number | null;
    unit: 'percent' | 'days' | 'boolean' | 'context';
    source: ProductAnalysis['source'];
    isSynthetic: boolean;
}

export interface Comparison {
    source: ProductAnalysis['source'];
    isSynthetic: boolean;
    dataProvider: string;
    observation: ProductObservation;
    enteredLandedCost: number | null;
    missingCostFields: string[];
    qualityFlags: string[];
    scenario: ContributionScenario;
    comparisonStatus: 'first_observation' | 'context_missing' | 'comparable' | 'gap_exceeds_window';
    previousObservedAt: string | null;
    elapsedDays: number | null;
    previousPrice: number | null;
    priceChangePercent: number | null;
    previousEnteredLandedCost: number | null;
    landedCostChangePercent: number | null;
    deliveryDaysMaxChange: number | null;
    completeCostPeerCount: number;
    enteredCostRank: number | null;
}

function quality(item: ProductObservation, check: CostCheck): string[] {
    const flags = [...check.missing.map((field) => `missing:${field}`)];
    if (item.variant === null) flags.push('missing:variant');
    if (item.priceBasis === 'new-customer') flags.push('new_customer_offer_not_repeatable_cost');
    if (item.priceBasis === 'conditional') flags.push('conditional_offer_not_repeatable_cost');
    if (item.inStock === null) flags.push('stock_unknown');
    if (item.deliveryDaysMax === null) flags.push('delivery_estimate_unknown');
    if (item.soldCount !== null && item.soldCountBasis !== 'exact') flags.push('sold_count_not_declared_exact');
    if (item.mrp !== null && item.mrp < item.price) flags.push('price_above_supplied_reference');
    if (item.statedDiscountPercent !== null && item.mrp !== null && item.mrp > 0
        && Math.abs(item.statedDiscountPercent - (item.mrp - item.price) / item.mrp * 100) > 1) flags.push('discount_arithmetic_mismatch');
    if (item.title.includes('[redacted]')) flags.push('sensitive_text_redacted');
    return flags;
}

const percentChange = (current: number, previous: number): number | null => previous > 0 ? (current - previous) / previous * 100 : null;

export function buildReport(records: ProductAnalysis[], options: ScenarioOptions): {
    source: ProductAnalysis['source']; isSynthetic: boolean; assumptions: ScenarioOptions; warnings: string[];
    productCount: number; observationCount: number; comparisons: Comparison[]; findings: Finding[];
    usScopeCount: number; otherScopeCount: number; unknownScopeCount: number;
} {
    const comparisons: Comparison[] = [], findings: Finding[] = [];
    for (const record of records) {
        const previousByScope = new Map<string, ProductObservation>();
        const previousByOffer = new Map<string, ProductObservation>();
        for (const item of record.observations) {
            const check = costCheck(item);
            const row: Comparison = { source: record.source, isSynthetic: record.isSynthetic, dataProvider: record.dataProvider,
                observation: item, enteredLandedCost: check.enteredLandedCost === null ? null : round(check.enteredLandedCost),
                missingCostFields: check.missing, qualityFlags: quality(item, check), scenario: contributionScenario(item, options),
                comparisonStatus: hasComparisonContext(item) ? 'first_observation' : 'context_missing',
                previousObservedAt: null, elapsedDays: null, previousPrice: null, priceChangePercent: null,
                previousEnteredLandedCost: null, landedCostChangePercent: null, deliveryDaysMaxChange: null,
                completeCostPeerCount: 0, enteredCostRank: null };
            const scope = observationScope(item);
            const previous = previousByScope.get(scope);
            const addFinding = (prior: ProductObservation, type: Finding['type'], previousValue: Finding['previousValue'], currentValue: Finding['currentValue'], change: number | null, threshold: number | null, unit: Finding['unit']): void => {
                findings.push({ type, productId: item.productId, variant: item.variant, previousObservedAt: prior.observedAt,
                    observedAt: item.observedAt, currency: item.currency, shipToCountry: item.shipToCountry,
                    previousValue, currentValue, change: change === null ? null : round(change), threshold, unit,
                    source: record.source, isSynthetic: record.isSynthetic });
            };
            if (previous && hasComparisonContext(item)) {
                const elapsed = (Date.parse(item.observedAt) - Date.parse(previous.observedAt)) / 86_400_000;
                row.previousObservedAt = previous.observedAt; row.elapsedDays = round(elapsed);
                if (elapsed > options.comparisonWindowDays) {
                    row.comparisonStatus = 'gap_exceeds_window'; row.qualityFlags.push('comparison_gap_exceeds_window');
                } else {
                    row.comparisonStatus = 'comparable'; row.previousPrice = previous.price;
                    const priceChange = percentChange(item.price, previous.price);
                    row.priceChangePercent = priceChange === null ? null : round(priceChange);
                    if (priceChange !== null && changeMeetsThreshold(item.price, previous.price, options.priceChangeThresholdPercent, true)) {
                        addFinding(previous, 'price_changed', previous.price, item.price, priceChange, options.priceChangeThresholdPercent, 'percent');
                    }
                    const previousCost = costCheck(previous).enteredLandedCost;
                    row.previousEnteredLandedCost = previousCost === null ? null : round(previousCost);
                    if (check.enteredLandedCost !== null && previousCost !== null) {
                        const costChange = percentChange(check.enteredLandedCost, previousCost);
                        row.landedCostChangePercent = costChange === null ? null : round(costChange);
                        if (costChange !== null && changeMeetsThreshold(check.enteredLandedCost, previousCost, options.landedCostRiseThresholdPercent)) {
                            addFinding(previous, 'entered_cost_increased', round(previousCost), round(check.enteredLandedCost), costChange, options.landedCostRiseThresholdPercent, 'percent');
                        }
                    }
                    if (item.deliveryDaysMax !== null && previous.deliveryDaysMax !== null) {
                        const days = item.deliveryDaysMax - previous.deliveryDaysMax;
                        row.deliveryDaysMaxChange = days;
                        if (days >= options.deliveryIncreaseThresholdDays) addFinding(previous, 'delivery_slower', previous.deliveryDaysMax, item.deliveryDaysMax, days, options.deliveryIncreaseThresholdDays, 'days');
                    }
                    if (previous.inStock === true && item.inStock === false) addFinding(previous, 'supplied_stock_out', true, false, null, null, 'boolean');
                }
            }
            previousByScope.set(scope, item);
            // A changed offer/tax basis is review evidence, never a valid price delta.
            const offerKey = JSON.stringify([item.variant, item.currency, item.shipToCountry, item.quantityBasis]);
            const previousOffer = previousByOffer.get(offerKey);
            if (previousOffer && item.variant !== null && item.currency !== null && item.shipToCountry !== null
                && item.quantityBasis === 'per-unit' && Date.parse(item.observedAt) > Date.parse(previousOffer.observedAt)
                && Date.parse(item.observedAt) - Date.parse(previousOffer.observedAt) <= options.comparisonWindowDays * 86_400_000
                && (previousOffer.priceBasis !== item.priceBasis || previousOffer.taxBasis !== item.taxBasis)) {
                row.qualityFlags.push('offer_context_changed');
                addFinding(previousOffer, 'offer_context_changed', `${previousOffer.priceBasis}/${previousOffer.taxBasis}`,
                    `${item.priceBasis}/${item.taxBasis}`, null, null, 'context');
            }
            previousByOffer.set(offerKey, item); comparisons.push(row);
        }
    }
    const cohorts = new Map<string, Comparison[]>();
    for (const row of comparisons) {
        const item = row.observation;
        if (!item.comparisonGroup || !hasComparisonContext(item) || row.enteredLandedCost === null) continue;
        const key = JSON.stringify([item.comparisonGroup, item.observedAt, item.currency, item.shipToCountry, item.priceBasis, item.taxBasis, item.quantityBasis]);
        const cohort = cohorts.get(key) ?? []; cohort.push(row); cohorts.set(key, cohort);
    }
    for (const cohort of cohorts.values()) {
        const distinctProducts = new Set(cohort.map((row) => row.observation.productId));
        // Compute each exact cost once, then rank in O(n log n), not O(n²)
        // repeated decimal parsing/allocation at the 1,000-observation limit.
        const ranked = cohort.map((row) => ({ row, cost: costCheck(row.observation).enteredLandedCost! })).sort((a, b) => a.cost - b.cost);
        let previousCost: number | undefined, rank = 0;
        for (const [index, { row, cost }] of ranked.entries()) {
            if (cost !== previousCost) rank = index + 1;
            previousCost = cost; row.completeCostPeerCount = cohort.length;
            if (distinctProducts.size >= 2) row.enteredCostRank = rank;
        }
    }
    return { source: records[0]?.source ?? 'user-authorized-import', isSynthetic: records[0]?.isSynthetic ?? false,
        assumptions: options, warnings: [
            'User-supplied observations only. No source lookup, checkout, API request, currency conversion or live verification.',
            'Entered landed cost is only the supplied price + shipping + additional tax + duty, not a guaranteed delivered price.',
            'Contribution scenarios are hypothetical, not net profit, tax advice, sales forecasts or proof a product will sell. Rates are user assumptions, not current marketplace rates.',
            'Unspecified scenario fee/cost options default to 0. Include your actual fees, fulfillment, advertising and returns assumptions; overhead and income taxes are not modeled.',
            'Comparisons require explicit matching variant, currency, destination, standard offer, tax basis and per-unit basis. Time gaps above the configured window do not trigger numeric change findings.',
            'Peer rank covers complete-cost observations at the exact supplied time in a user-declared group, not the entire market or proof of equivalent products. Multiple variants can be separate quotes.',
            'Findings inspect this supplied export only. No persistent history, automatic monitoring, notifications or schedules are created.',
        ], productCount: records.length, observationCount: comparisons.length, comparisons, findings,
        usScopeCount: comparisons.filter((row) => row.observation.shipToCountry === 'US').length,
        otherScopeCount: comparisons.filter((row) => row.observation.shipToCountry !== null && row.observation.shipToCountry !== 'US').length,
        unknownScopeCount: comparisons.filter((row) => row.observation.shipToCountry === null).length };
}

export type SourcingReport = ReturnType<typeof buildReport>;
const OBSERVATION_COLUMNS = ['productId', 'title', 'variant', 'observedAt', 'currency', 'shipToCountry', 'priceBasis', 'taxBasis',
    'quantityBasis', 'comparisonGroup', 'price', 'shippingCost', 'taxCost', 'dutyCost', 'mrp', 'statedDiscountPercent',
    'calculatedDiscountPercent', 'rating', 'ratingCount', 'soldCount', 'soldCountBasis', 'deliveryDaysMin', 'deliveryDaysMax',
    'inStock', 'productUrl', 'brand', 'category'] as const;
export function comparisonCsv(report: SourcingReport): string {
    const headers = ['source', 'isSynthetic', 'dataProvider', ...OBSERVATION_COLUMNS, 'enteredLandedCost', 'missingCostFields',
        'qualityFlags', 'comparisonStatus', 'previousObservedAt', 'elapsedDays', 'previousPrice', 'priceChangePercent',
        'previousEnteredLandedCost', 'landedCostChangePercent', 'deliveryDaysMaxChange', 'completeCostPeerCount', 'enteredCostRank',
        'scenarioStatus', 'contributionUsd', 'contributionMarginPercent', 'breakEvenRetailUsd', 'maxAdSpendForTargetUsd', 'meetsTarget'];
    return [headers.map(csvCell).join(','), ...report.comparisons.map((row) => [row.source, row.isSynthetic, row.dataProvider,
        ...OBSERVATION_COLUMNS.map((field) => row.observation[field]), row.enteredLandedCost, row.missingCostFields.join('; '),
        row.qualityFlags.join('; '), row.comparisonStatus, row.previousObservedAt, row.elapsedDays, row.previousPrice, row.priceChangePercent,
        row.previousEnteredLandedCost, row.landedCostChangePercent, row.deliveryDaysMaxChange, row.completeCostPeerCount, row.enteredCostRank,
        row.scenario.status, row.scenario.contributionUsd, row.scenario.contributionMarginPercent, row.scenario.breakEvenRetailUsd,
        row.scenario.maxAdSpendForTargetUsd, row.scenario.meetsTarget].map(csvCell).join(','))].join('\r\n');
}

export function findingsCsv(report: SourcingReport): string {
    const fields: (keyof Finding)[] = ['source', 'isSynthetic', 'type', 'productId', 'variant', 'previousObservedAt', 'observedAt',
        'currency', 'shipToCountry', 'previousValue', 'currentValue', 'change', 'threshold', 'unit'];
    return [fields.map(csvCell).join(','), ...report.findings.map((finding) => fields.map((field) => csvCell(finding[field])).join(','))].join('\r\n');
}

export function qualityCsv(report: SourcingReport): string {
    return [['source', 'isSynthetic', 'productId', 'variant', 'observedAt', 'currency', 'shipToCountry', 'missingCostFields', 'qualityFlags', 'comparisonStatus'].map(csvCell).join(','),
        ...report.comparisons.map((row) => [row.source, row.isSynthetic, row.observation.productId, row.observation.variant,
            row.observation.observedAt, row.observation.currency, row.observation.shipToCountry, row.missingCostFields.join('; '),
            row.qualityFlags.join('; '), row.comparisonStatus].map(csvCell).join(','))].join('\r\n');
}

export function reportMarkdown(report: SourcingReport): string {
    const rows = report.comparisons.map((row) => `| ${markdownText(row.observation.productId)} | ${markdownText(row.observation.title)} | ${markdownText(row.observation.variant)} | ${row.observation.observedAt} | ${row.observation.currency ?? 'unknown'} / ${row.observation.shipToCountry ?? 'unknown'} | ${row.observation.price} | ${row.enteredLandedCost ?? 'unknown'} | ${row.scenario.contributionMarginPercent ?? 'not calculated'} | ${row.comparisonStatus} |`);
    return [`# ${report.isSynthetic ? 'SYNTHETIC DEMO' : 'Authorized export'} — US product sourcing report`, '',
        report.isSynthetic ? '**Invented example values, not live AliExpress offers. Zero product-result events and dataset rows. Actor Start and applicable platform usage still apply.**'
            : 'User-provided export analyzed without a live AliExpress lookup. Saved product analyses retain their normal result fees.', '',
        ...report.warnings.map((warning) => `- ${warning}`), '',
        `Products: ${report.productCount}; supplied observations: ${report.observationCount}; review findings: ${report.findings.length}.`,
        `Destination labels supplied: US ${report.usScopeCount}; other ${report.otherScopeCount}; unknown ${report.unknownScopeCount}. This is not geographic verification.`, '',
        '## Explicit scenario assumptions', '',
        '```json', JSON.stringify(report.assumptions, null, 2), '```', '',
        '| Product ID | Title | Variant | Supplied time | Currency / destination | Price | Entered landed cost | Scenario contribution % | Comparison |',
        '| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |', ...rows, '',
        '## Review findings', '',
        ...report.findings.map((finding) => `- ${finding.type}: product ${finding.productId}, ${markdownText(finding.variant)}, ${finding.previousObservedAt} → ${finding.observedAt}; ${markdownText(finding.previousValue)} → ${markdownText(finding.currentValue)}${finding.change === null ? '' : ` (${finding.change} ${finding.unit})`}.`),
        ...(report.findings.length ? [] : ['No configured threshold findings in the supplied observations. This does not prove stable live prices, availability or safety.']), '',
    ].join('\n');
}
