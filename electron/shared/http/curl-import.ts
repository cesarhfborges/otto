import type { KeyValue } from '../models/common';
import { HTTP_METHODS, type HttpMethod } from '../models/http';
import type { MultipartField, RequestAuth, RequestBody, RequestDefinition } from '../models/request';

/** Parte da requisição obtida de um comando cURL. */
export type CurlImport = Pick<RequestDefinition, 'method' | 'url' | 'params' | 'headers' | 'auth' | 'body'>;

/** Parece um comando cURL colado (ex.: "Copy as cURL" do DevTools)? */
export const looksLikeCurl = (text: string): boolean => /^\s*curl(\.exe)?\s/i.test(text);

/**
 * Separa os argumentos como um shell POSIX faria: aspas simples, duplas, `$'…'`,
 * escapes e continuações de linha (`\` + quebra, e `^` do cmd do Windows).
 */
export function tokenizeShell(command: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inToken = false;
    let i = 0;
    const text = command.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');

    while (i < text.length) {
        const char = text[i]!;

        if (/\s/.test(char)) {
            if (inToken) {
                tokens.push(current);
                current = '';
                inToken = false;
            }

            i++;
        } else if (char === "'") {
            const end = text.indexOf("'", i + 1);

            current += text.slice(i + 1, end < 0 ? undefined : end);
            inToken = true;
            i = end < 0 ? text.length : end + 1;
        } else if (char === '$' && text[i + 1] === "'") {
            // ANSI-C: $'…' com \n, \t, \' e \\.
            i += 2;
            inToken = true;

            while (i < text.length && text[i] !== "'") {
                if (text[i] === '\\' && i + 1 < text.length) {
                    const next = text[i + 1]!;

                    current += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next;
                    i += 2;
                } else {
                    current += text[i++];
                }
            }

            i++;
        } else if (char === '"') {
            i++;
            inToken = true;

            while (i < text.length && text[i] !== '"') {
                if (text[i] === '\\' && /["\\$`]/.test(text[i + 1] ?? '')) {
                    current += text[i + 1];
                    i += 2;
                } else {
                    current += text[i++];
                }
            }

            i++;
        } else if (char === '\\' && i + 1 < text.length) {
            current += text[i + 1];
            inToken = true;
            i += 2;
        } else {
            current += char;
            inToken = true;
            i++;
        }
    }

    if (inToken) {
        tokens.push(current);
    }

    return tokens;
}

/** Opções que levam valor e são ignoradas (não afetam a requisição). */
const IGNORED_WITH_VALUE = new Set([
    '-o',
    '--output',
    '-m',
    '--max-time',
    '--connect-timeout',
    '-w',
    '--write-out',
    '--retry',
    '-A',
    '--user-agent',
    '-e',
    '--referer',
    '--cacert',
    '--cert',
    '--key',
    '-x',
    '--proxy',
    '-c',
    '--cookie-jar',
    '--resolve',
    '--limit-rate'
]);

const DATA_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-ascii', '--data-binary', '--data-urlencode', '--json']);

function splitHeader(raw: string): KeyValue | null {
    const colon = raw.indexOf(':');

    return colon > 0 ? { key: raw.slice(0, colon).trim(), value: raw.slice(colon + 1).trim(), enabled: true } : null;
}

function bodyFrom(data: string[], json: boolean, contentType: string): RequestBody {
    const content = data.join('&');

    if (json || /json/i.test(contentType)) {
        try {
            return { type: 'json', content: JSON.stringify(JSON.parse(content), null, 2) };
        } catch {
            return { type: 'json', content };
        }
    }

    if (/xml/i.test(contentType)) {
        return { type: 'xml', content };
    }

    if (!contentType || /x-www-form-urlencoded/i.test(contentType)) {
        const fields = content
            .split('&')
            .filter(Boolean)
            .map((pair) => {
                const [key = '', ...value] = pair.split('=');
                const decode = (text: string): string => {
                    try {
                        return decodeURIComponent(text.replace(/\+/g, ' '));
                    } catch {
                        return text;
                    }
                };

                return { key: decode(key), value: decode(value.join('=')), enabled: true };
            });

        if (fields.every((field) => field.key && !/[\s{}[\]"]/.test(field.key))) {
            return { type: 'form-urlencoded', fields };
        }
    }

    return { type: 'text', content };
}

/** Converte um comando cURL nos campos da requisição. Lança erro se não houver URL. */
export function parseCurl(command: string): CurlImport {
    const tokens = tokenizeShell(command.trim());

    if (!/^curl(\.exe)?$/i.test(tokens[0] ?? '')) {
        throw new Error('The command must start with "curl"');
    }

    let method: HttpMethod | null = null;
    let url = '';
    let auth: RequestAuth = { type: 'none' };
    let json = false;
    let get = false;
    const headers: KeyValue[] = [];
    const data: string[] = [];
    const form: MultipartField[] = [];

    for (let i = 1; i < tokens.length; i++) {
        const token = tokens[i]!;
        const [flag, inline] = token.startsWith('--') && token.includes('=') ? [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)] : [token, undefined];
        const value = (): string => inline ?? tokens[++i] ?? '';

        if (flag === '-X' || flag === '--request') {
            const wanted = value().toUpperCase();

            method = (HTTP_METHODS as readonly string[]).includes(wanted) ? (wanted as HttpMethod) : method;
        } else if (/^-X[A-Z]+$/.test(flag)) {
            const wanted = flag.slice(2);

            method = (HTTP_METHODS as readonly string[]).includes(wanted) ? (wanted as HttpMethod) : method;
        } else if (flag === '-H' || flag === '--header') {
            const header = splitHeader(value());

            if (header) {
                headers.push(header);
            }
        } else if (DATA_FLAGS.has(flag)) {
            const raw = value();

            json ||= flag === '--json';
            data.push(flag === '--data-urlencode' && raw.includes('=') ? `${raw.slice(0, raw.indexOf('='))}=${encodeURIComponent(raw.slice(raw.indexOf('=') + 1))}` : raw);
        } else if (flag === '-F' || flag === '--form' || flag === '--form-string') {
            const raw = value();
            const eq = raw.indexOf('=');
            const fieldValue = raw.slice(eq + 1);
            const file = flag !== '--form-string' && fieldValue.startsWith('@');

            form.push({ key: raw.slice(0, eq), value: file ? fieldValue.slice(1).split(';')[0]! : fieldValue, enabled: true, kind: file ? 'file' : 'text' });
        } else if (flag === '-u' || flag === '--user') {
            const raw = value();
            const colon = raw.indexOf(':');

            auth = { type: 'basic', username: colon >= 0 ? raw.slice(0, colon) : raw, password: colon >= 0 ? raw.slice(colon + 1) : '' };
        } else if (flag === '-b' || flag === '--cookie') {
            headers.push({ key: 'Cookie', value: value(), enabled: true });
        } else if (flag === '-I' || flag === '--head') {
            method = 'HEAD';
        } else if (flag === '-G' || flag === '--get') {
            get = true;
        } else if (flag === '--url') {
            url = value();
        } else if (IGNORED_WITH_VALUE.has(flag)) {
            value();
        } else if (!flag.startsWith('-') && !url) {
            url = flag;
        }
    }

    if (!url) {
        throw new Error('No URL found in the cURL command');
    }

    if (json) {
        if (!headers.some((header) => header.key.toLowerCase() === 'content-type')) {
            headers.push({ key: 'Content-Type', value: 'application/json', enabled: true });
        }

        if (!headers.some((header) => header.key.toLowerCase() === 'accept')) {
            headers.push({ key: 'Accept', value: 'application/json', enabled: true });
        }
    }

    // `-G`: os dados vão para a query string.
    if (get && data.length) {
        url += (url.includes('?') ? '&' : '?') + data.join('&');
        data.length = 0;
    }

    // Bearer no header vira a autenticação da requisição.
    const authorization = headers.findIndex((header) => header.key.toLowerCase() === 'authorization' && /^bearer\s+/i.test(header.value));

    if (authorization >= 0 && auth.type === 'none') {
        auth = { type: 'bearer', token: headers[authorization]!.value.replace(/^bearer\s+/i, '') };
        headers.splice(authorization, 1);
    }

    const contentType = headers.find((header) => header.key.toLowerCase() === 'content-type')?.value ?? '';
    const body: RequestBody = form.length ? { type: 'multipart-form', fields: form } : data.length ? bodyFrom(data, json, contentType) : { type: 'none' };

    // Query string vira a lista de params (a URL fica sem ela).
    const params: KeyValue[] = [];
    const queryStart = url.indexOf('?');

    if (queryStart >= 0) {
        const hashStart = url.indexOf('#', queryStart);
        const query = url.slice(queryStart + 1, hashStart < 0 ? undefined : hashStart);

        for (const pair of query.split('&').filter(Boolean)) {
            const [key = '', ...rest] = pair.split('=');
            const decode = (text: string): string => {
                try {
                    return decodeURIComponent(text.replace(/\+/g, ' '));
                } catch {
                    return text;
                }
            };

            params.push({ key: decode(key), value: decode(rest.join('=')), enabled: true });
        }

        url = url.slice(0, queryStart);
    }

    // Multipart: o main define o Content-Type com o boundary.
    const keptHeaders = form.length ? headers.filter((header) => header.key.toLowerCase() !== 'content-type') : headers;

    return {
        method: method ?? (data.length || form.length ? 'POST' : 'GET'),
        url,
        params,
        headers: keptHeaders,
        auth,
        body
    };
}
