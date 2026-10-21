import type { HttpResponse, KeyValue, RequestDefinition } from '../models';
import { Cookies, HeaderList, parseCookieHeader, parseSetCookie } from './cookies';
import { CircularReferenceError, TemplateError, UnresolvedError } from './errors';
import { jsonPathAll } from './jsonpath';
import { cssFirst, regexMatch, xpathFirst } from './markup';

/** Uma requisição (já interpolada) ou resposta guardada, no formato lido por `otto.*`. */
export interface MessageSnapshot {
    kind: 'request' | 'response';
    url: string;
    headers: Array<[string, string]>;
    body: string;
    bodyEncoding: 'utf8' | 'base64';
    bodyType: string;
    method?: string;
    params?: Array<[string, string]>;
    forms?: Array<[string, string]>;
    auth?: Record<string, string>;
    status?: number;
    statusText?: string;
    timeMs?: number;
    timings?: { ttfb: number; download: number; total: number };
    receivedAt?: string;
    redirected?: boolean;
    size?: number;
}

/** O que o campo em avaliação não pode ler de si mesmo (`Cookie: {{ otto.request.header('Cookie') }}`). */
export interface ReadGuard {
    header?: string;
    body?: boolean;
}

const enabled = (items: KeyValue[]): Array<[string, string]> => items.filter((item) => item.enabled && item.key).map((item) => [item.key, item.value]);

const bodyTypeOf = (contentType: string | null): string => {
    const type = (contentType ?? '').toLowerCase();

    return !type
        ? 'none'
        : type.includes('json')
          ? 'json'
          : type.includes('xml') || type.includes('html')
            ? 'xml'
            : type.includes('x-www-form-urlencoded')
              ? 'form-urlencoded'
              : type.includes('multipart')
                ? 'multipart-form'
                : type.startsWith('text/')
                  ? 'text'
                  : 'binary';
};

/** Definição já interpolada → snapshot (sem ler arquivos: corpos binários ficam vazios). */
export function requestSnapshot(definition: RequestDefinition): MessageSnapshot {
    const { body, auth } = definition;
    const forms = body.type === 'form-urlencoded' || body.type === 'multipart-form' ? enabled(body.fields) : [];
    const text = body.type === 'json' || body.type === 'text' || body.type === 'xml' ? body.content : body.type === 'form-urlencoded' ? new URLSearchParams(forms).toString() : '';
    const { type: authType, ...authFields } = auth;

    return {
        kind: 'request',
        url: definition.url,
        method: definition.method,
        headers: enabled(definition.headers),
        params: enabled(definition.params),
        forms,
        body: text,
        bodyEncoding: 'utf8',
        bodyType: body.type,
        auth: { type: authType, ...Object.fromEntries(Object.entries(authFields).map(([key, value]) => [key, String(value)])) }
    };
}

export function responseSnapshot(response: HttpResponse, receivedAt: Date): MessageSnapshot {
    return {
        kind: 'response',
        url: response.url,
        headers: response.headers,
        body: response.body,
        bodyEncoding: response.bodyEncoding,
        bodyType: bodyTypeOf(response.contentType),
        status: response.status,
        statusText: response.statusText,
        timeMs: response.timeMs,
        timings: { ttfb: response.timings.ttfbMs, download: response.timings.downloadMs, total: response.timings.totalMs },
        receivedAt: receivedAt.toISOString(),
        redirected: response.redirected,
        size: response.size
    };
}

const utf8 = (base64: string): string => new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
const toBase64 = (text: string): string => btoa(Array.from(new TextEncoder().encode(text), (byte) => String.fromCharCode(byte)).join(''));

function urlPart(url: string, part: 'host' | 'pathname' | 'protocol' | 'port'): string {
    try {
        return new URL(url)[part];
    } catch {
        return '';
    }
}

const found = <T>(value: T | undefined, what: string): T => {
    if (value === undefined) {
        throw new UnresolvedError(`${what} not found`);
    }

    return value;
};

/**
 * Leitura de mensagens (§3.6 do plano): mesmos nomes em `otto.request`,
 * `otto.request(…).request/.response` e, nos scripts, `otto.response`.
 */
export function messageReader(message: MessageSnapshot, now: Date, guard: ReadGuard = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const isResponse = message.kind === 'response';
    const headers = new HeaderList(message.headers);
    const readHeader = (name: string): void => {
        if (guard.header && guard.header.toLowerCase() === String(name).toLowerCase()) {
            throw new CircularReferenceError(`Circular reference: header "${name}" reads itself`);
        }
    };
    const text = (): string => {
        if (guard.body) {
            throw new CircularReferenceError('Circular reference: the body reads itself');
        }

        return message.bodyEncoding === 'base64' ? utf8(message.body) : message.body;
    };
    const json = (): unknown => {
        try {
            return JSON.parse(text());
        } catch (error) {
            if (error instanceof TemplateError) {
                throw error;
            }

            throw new TemplateError('Body is not valid JSON');
        }
    };
    const select = (path: string): unknown[] => {
        if (String(path).startsWith('/')) {
            throw new TemplateError('This is an XPath: use body.xml(…) (json() takes a JSONPath, $.…)');
        }

        return jsonPathAll(json(), String(path));
    };
    const parsed = (): unknown => {
        switch (message.bodyType) {
            case 'json':
                return json();
            case 'form-urlencoded':
                return message.forms?.length ? Object.fromEntries(message.forms) : Object.fromEntries(new URLSearchParams(text()));
            default:
                return text();
        }
    };
    /** Com JSONPath: o primeiro valor encontrado; sem: o objeto inteiro. */
    const jsonAt = (path?: string): unknown => (path === undefined || path === '' ? json() : found(select(path)[0], `"${path}"`));
    const body = {
        text,
        json: jsonAt,
        jsonAll: (path: string) => select(path),
        xml: (xpath: string) => xpathFirst(text(), String(xpath)),
        html: (selector: string) => cssFirst(text(), String(selector)),
        regex: (pattern: string, group?: number | string) => regexMatch(text(), String(pattern), group),
        base64: () => (message.bodyEncoding === 'base64' ? message.body : toBase64(text())),
        get parsed() {
            return parsed();
        },
        type: message.bodyType,
        size: message.size ?? new TextEncoder().encode(message.body).length,
        toTemplateString: text
    };
    const cookiePairs = (): Array<[string, string]> =>
        isResponse
            ? headers.all('set-cookie').flatMap((header) => {
                  const info = parseSetCookie(header);

                  return info ? [[info.name, info.value] as [string, string]] : [];
              })
            : parseCookieHeader(headers.get('cookie') ?? '');
    const cookies = (): Cookies => {
        readHeader('Cookie');

        return new Cookies(cookiePairs());
    };

    const reader: Record<string, unknown> = {
        ...extra,
        body,
        json: jsonAt,
        get data() {
            return parsed();
        },
        form: (name: string) => found(message.forms?.find(([key]) => key === name)?.[1], `Form field "${name}"`),
        forms: () => Object.fromEntries(message.forms ?? []),
        header: (name: string) => (readHeader(name), found(headers.get(name), `Header "${name}"`)),
        headerAll: (name: string) => (readHeader(name), headers.all(name)),
        headers: () => headers,
        hasHeader: (name: string) => headers.has(name),
        contentType: (headers.get('content-type') ?? '').split(';')[0]!.trim(),
        cookie: (name: string) => found(cookies().get(name), `Cookie "${name}"`),
        cookies,
        hasCookie: (name: string) => cookies().has(name),
        url: message.url,
        host: urlPart(message.url, 'host'),
        pathname: urlPart(message.url, 'pathname'),
        protocol: urlPart(message.url, 'protocol'),
        port: urlPart(message.url, 'port'),
        toTemplateString: text
    };

    if (isResponse) {
        Object.assign(reader, {
            cookieInfo: (name: string) =>
                found(
                    headers
                        .all('set-cookie')
                        .map(parseSetCookie)
                        .find((info) => info?.name === name) ?? undefined,
                    `Cookie "${name}"`
                ),
            status: message.status,
            code: message.status,
            statusText: message.statusText,
            ok: (message.status ?? 0) >= 200 && (message.status ?? 0) < 300,
            time: message.timeMs,
            timings: message.timings,
            receivedAt: message.receivedAt,
            age: message.receivedAt ? Math.max(0, Math.round((now.getTime() - Date.parse(message.receivedAt)) / 1000)) : 0,
            redirected: message.redirected
        });
    } else {
        Object.assign(reader, {
            method: message.method,
            param: (name: string) => found(message.params?.find(([key]) => key === name)?.[1], `Query parameter "${name}"`),
            params: () => Object.fromEntries(message.params ?? []),
            auth: message.auth ?? { type: 'none' }
        });
    }

    return reader;
}
