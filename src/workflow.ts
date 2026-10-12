import { normalizeInput } from './input.js';
import { prepareImport } from './importer.js';
import { assertDemoInput, demoRows } from './demo-presets.js';
import { buildReport, comparisonCsv, findingsCsv, qualityCsv, reportMarkdown } from './analysis.js';
import type { ChargeResultLike, ProductAnalysis } from './types.js';

export interface Ports {
    canSave(): boolean;
    save(record: ProductAnalysis & { singleProductAnalysis: ReturnType<typeof buildReport> }): Promise<ChargeResultLike>;
    write(key: string, value: unknown, contentType?: string): Promise<void>;
    status(message: string): Promise<void>;
}

export class DeliveryError extends Error { readonly code = 'DELIVERY_FAILED'; }

export async function runWorkflow(raw: unknown, ports: Ports, now = new Date()): Promise<Record<string, unknown>> {
    const input = normalizeInput(raw);
    let records: ProductAnalysis[], saved: ProductAnalysis[] = [], stopped = false, saveFailed = false;
    let chargedProductEvents = 0;
    const plan = (() => {
        if (input.mode === 'import') return prepareImport(raw, now);
        assertDemoInput(raw);
        return prepareImport({ mode: 'import', authorizedData: true, importSource: 'SYNTHETIC DEMO — invented values, not AliExpress measurements',
            importJson: JSON.stringify(demoRows(input.demoPreset)), maxResults: 3 }, now);
    })();
    records = plan.records;
    if (input.mode === 'demo') {
        records = records.map((record) => ({ ...record, recordType: 'synthetic-product-preview', source: 'synthetic-demo', isSynthetic: true,
            productUrl: null, observations: record.observations.map((item) => ({ ...item, productUrl: null, imageUrl: null })) }));
    } else {
        for (const record of records) {
            try {
                if (!ports.canSave()) { stopped = true; break; }
                const result = await ports.save({ ...record, singleProductAnalysis: buildReport([record], input.scenario) });
                if (!result || ![0, 1].includes(result.chargedCount) || typeof result.eventChargeLimitReached !== 'boolean') {
                    throw new DeliveryError('Unrecognized result delivery acknowledgment.');
                }
                if (result.chargedCount === 1 || !result.eventChargeLimitReached) saved.push(record);
                chargedProductEvents += result.chargedCount;
                if (result.eventChargeLimitReached) { stopped = true; break; }
            } catch { saveFailed = true; break; }
        }
    }
    const isDemo = input.mode === 'demo';
    const delivered = isDemo ? records : saved;
    const report = buildReport(delivered, input.scenario);
    // Empty import output keeps import provenance; demo always has developer-authored previews.
    const summary = {
        mode: input.mode, source: isDemo ? 'synthetic-demo' : 'user-authorized-import', isSynthetic: isDemo,
        outcome: saveFailed ? 'failed_delivery' : isDemo ? 'demo_complete' : stopped && saved.length < plan.selectedProductCount ? 'stopped_spending_limit' : 'succeeded',
        demoPreset: isDemo ? input.demoPreset : null,
        dataProvider: plan.dataProvider, spendingLimitReached: stopped,
        completeSelectedOutput: isDemo ? true : !saveFailed && saved.length === plan.selectedProductCount,
        savedProductCount: saved.length, savedObservationCount: saved.reduce((sum, record) => sum + record.observationCount, 0),
        productResultEventCount: chargedProductEvents, previewProductCount: isDemo ? records.length : 0,
        previewObservationCount: isDemo ? report.observationCount : 0,
        unsavedSelectedProductCount: isDemo ? 0 : plan.selectedProductCount - saved.length,
        inputRowCount: isDemo ? 0 : plan.inputRowCount,
        normalizedObservationCount: isDemo ? 0 : plan.normalizedObservationCount,
        duplicateObservationsRemoved: isDemo ? 0 : plan.duplicateObservationsRemoved,
        selectedProductCount: isDemo ? 0 : plan.selectedProductCount,
        omittedProductCount: isDemo ? 0 : plan.omittedProductCount,
        unsupportedColumnsDropped: isDemo ? 0 : plan.unsupportedColumnsDropped,
        upstreamRequestCount: 0, liveSourceVerified: false, sourceRightsVerified: false, persistentHistoryWritten: false,
        reportsComplete: !saveFailed,
        ...(!isDemo ? { resultEventCountSource: 'confirmed custom product counter deltas, not final platform billing',
            unconfirmedDeliveryAttempt: saveFailed,
            unconfirmedDeliveryNotice: saveFailed ? 'A save/charge attempt may already have persisted and billed a product. Inspect the dataset and platform billing; no retry was attempted.' : null } : {}),
        chargeNotice: isDemo ? 'No product-result events. Actor Start and platform usage still apply.'
            : 'One product-result event per successfully saved product analysis, including supplied observations and reports. Actor Start and platform usage also apply.',
    };
    try {
        await ports.write('REPORT', { summary, products: delivered, analysis: report });
        await ports.write('COMPARISON.csv', comparisonCsv(report), 'text/csv; charset=utf-8');
        await ports.write('FINDINGS.csv', findingsCsv(report), 'text/csv; charset=utf-8');
        await ports.write('QUALITY.csv', qualityCsv(report), 'text/csv; charset=utf-8');
        await ports.write('REPORT.md', reportMarkdown(report), 'text/markdown; charset=utf-8');
        await ports.write('RUN_STATUS', summary);
    } catch {
        await ports.write('RUN_STATUS', { ...summary, outcome: 'failed_delivery', reportsComplete: false }).catch(() => undefined);
        throw new DeliveryError('Report delivery failed. Previously saved product analyses retain their normal charges; no additional products were attempted. Demo has no product-result charges.');
    }
    if (saveFailed) throw new DeliveryError('Product delivery was not confirmed. An attempted save may already have persisted and billed a product; inspect the dataset and platform billing. No retry, source request or extra product was attempted.');
    await ports.status(isDemo ? 'Synthetic demo complete: 0 dataset rows, 0 product-result events. Start/platform usage apply; no live AliExpress lookup.'
        : `Import ${summary.outcome}: ${saved.length} saved product analysis(es), ${summary.savedObservationCount} supplied observations; no live lookup.`);
    return summary;
}
