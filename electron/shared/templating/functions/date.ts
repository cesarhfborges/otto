import { TemplateError } from '../errors';
import { arg, fn, ns, opt, str, type CatalogNode } from '../node';

export const DATE_FORMATS = ['iso', 'unix', 'unixMs', 'YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss', 'DD/MM/YYYY', 'HH:mm:ss'] as const;

const pad = (value: number, size = 2): string => String(value).padStart(size, '0');

/** Partes da data no fuso pedido (ou no local), com o deslocamento em minutos. */
function partsOf(date: Date, tz?: string): { Y: number; M: number; D: number; h: number; m: number; s: number; offset: number } {
    if (!tz) {
        return { Y: date.getFullYear(), M: date.getMonth() + 1, D: date.getDate(), h: date.getHours(), m: date.getMinutes(), s: date.getSeconds(), offset: -date.getTimezoneOffset() };
    }

    let parts: Intl.DateTimeFormatPart[];

    try {
        parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date);
    } catch {
        throw new TemplateError(`Unknown time zone "${tz}"`);
    }

    const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
    const values = { Y: get('year'), M: get('month'), D: get('day'), h: get('hour'), m: get('minute'), s: get('second') };

    return { ...values, offset: Math.round((Date.UTC(values.Y, values.M - 1, values.D, values.h, values.m, values.s) - Math.floor(date.getTime() / 1000) * 1000) / 60_000) };
}

export function formatDate(date: Date, format = 'iso', tz?: string): string | number {
    if (format === 'iso') {
        return date.toISOString();
    }

    if (format === 'unix') {
        return Math.floor(date.getTime() / 1000);
    }

    if (format === 'unixMs') {
        return date.getTime();
    }

    const p = partsOf(date, tz);
    const zone = `${p.offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(p.offset) / 60))}:${pad(Math.abs(p.offset) % 60)}`;
    const tokens: Record<string, string> = { YYYY: String(p.Y), MM: pad(p.M), DD: pad(p.D), HH: pad(p.h), mm: pad(p.m), ss: pad(p.s), SSS: pad(date.getMilliseconds(), 3), Z: zone };

    return format.replace(/YYYY|SSS|MM|DD|HH|mm|ss|Z/g, (token) => tokens[token]!);
}

/** Texto ISO, segundos ou milissegundos Unix → `Date`. */
export function toDate(value: unknown): Date {
    const numeric = typeof value === 'number' || /^\d+$/.test(str(value)) ? Number(value) : NaN;
    const date = Number.isNaN(numeric) ? new Date(str(value)) : new Date(numeric < 1e12 ? numeric * 1000 : numeric);

    if (Number.isNaN(date.getTime())) {
        throw new TemplateError(`Invalid date "${str(value)}"`);
    }

    return date;
}

/** `30s`, `15m`, `2h`, `1d`, `1w`, `-1M`, `1y` somados a `from`. */
export function addDuration(from: Date, duration: string): Date {
    const match = /^(-?\d+)\s*(ms|s|m|h|d|w|M|y)$/.exec(duration.trim());

    if (!match) {
        throw new TemplateError(`Invalid duration "${duration}" (use 30s, 15m, 2h, 1d, 1w, 1M, 1y)`);
    }

    const amount = Number(match[1]);
    const date = new Date(from);
    const unit = match[2]!;

    if (unit === 'M') {
        date.setMonth(date.getMonth() + amount);
    } else if (unit === 'y') {
        date.setFullYear(date.getFullYear() + amount);
    } else {
        date.setTime(date.getTime() + amount * { ms: 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }[unit as 'ms']!);
    }

    return date;
}

const tzOf = (options: unknown): string | undefined => (typeof options === 'object' && options && 'tz' in options ? str((options as { tz: unknown }).tz) : undefined);
const formatArg = opt('format', { values: DATE_FORMATS });

export const DATE_FUNCTIONS: CatalogNode[] = [
    fn('now', 'string', 'Current date/time (ISO 8601, unix or tokens YYYY MM DD HH mm ss SSS Z)', [formatArg, opt('options')], (format?: string, options?: unknown) => formatDate(new Date(), format ? str(format) : 'iso', tzOf(options)), {
        example: "{{ otto.now('YYYY-MM-DD') }}"
    }),
    ns('date', 'Date math and formatting', [
        fn('add', 'string', 'Now plus a duration (30s, 15m, 2h, 1d, 1w, -1M, 1y)', [arg('duration', { values: ['1h', '1d', '7d', '-1d', '1M'] }), formatArg], (duration: string, format?: string) => formatDate(addDuration(new Date(), str(duration)), format ? str(format) : 'iso'), {
            example: "{{ otto.date.add('1d', 'YYYY-MM-DD') }}"
        }),
        fn('format', 'string', 'Reformat a date (ISO, unix seconds or ms)', [arg('value'), formatArg], (value: unknown, format?: string) => formatDate(toDate(value), format ? str(format) : 'iso')),
        fn('parse', 'string', 'Convert a date to another format', [arg('value'), formatArg], (value: unknown, format?: string) => formatDate(toDate(value), format ? str(format) : 'iso'))
    ])
];
