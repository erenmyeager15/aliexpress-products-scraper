// Offline value/URL safety only. There is deliberately no browser, fetch or scraping route.
export function redactSensitiveText(value: string): string {
    return value.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted]')
        .replace(/(?<!\w)(?:\+?\d[\s().-]*){9,}(?!\w)/g, '[redacted]')
        .replace(/\b(?:api[-_ ]?key|token|password|secret|authorization|cookie)\s*[:=]\s*\S+/gi, '[redacted]')
        .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, '[redacted]')
        .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Strict scalar parser. Reject ranges, signs, formulae, units and ambiguous grouping. */
export function parseNumber(value: unknown, minimum = 0, maximum = 1_000_000_000, integer = false): number | null {
    let number: number;
    if (typeof value === 'number') number = value;
    else if (typeof value === 'string') {
        const text = value.trim();
        if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return null;
        number = Number(text.replaceAll(',', ''));
    } else return null;
    return Number.isFinite(number) && number >= minimum && number <= maximum
        && (!integer || Number.isSafeInteger(number)) ? number : null;
}

export function safeProductUrl(value: unknown, productId: string): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > 1500) return null;
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
        if (!/^(?:[a-z0-9-]+\.)*aliexpress\.(?:com|us)$/i.test(url.hostname)) return null;
        const id = /^\/item\/(\d+)\.html$/.exec(url.pathname)?.[1];
        if (id !== productId) return null;
        return `https://${url.hostname.toLowerCase()}/item/${productId}.html`;
    } catch { return null; }
}

export function safeImageUrl(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > 1500) return null;
    try {
        const url = new URL(value.startsWith('//') ? `https:${value}` : value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
        if (!/^(?:[a-z0-9-]+\.)*(?:aliexpress-media\.com|alicdn\.com)$/i.test(url.hostname)) return null;
        url.protocol = 'https:'; url.search = ''; url.hash = '';
        return url.toString();
    } catch { return null; }
}

export function csvCell(value: unknown): string {
    let text = value === undefined || value === null ? '' : String(value);
    if (typeof value === 'string' && (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
}

export function markdownText(value: unknown): string {
    return String(value ?? 'unknown').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replace(/[\\`*_{}\[\]()#!|]/g, '\\$&').replace(/[\r\n]/g, ' ');
}

export const round = (value: number): number => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
