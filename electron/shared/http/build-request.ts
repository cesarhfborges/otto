import type { KeyValue } from '../models/common';
import { hasBody, type HttpMultipartPart, type HttpRequest, type HttpRequestSource } from '../models/http';
import type { RequestDefinition } from '../models/request';

export interface BuildRequestOptions {
    /** Identificador da execução (usado para cancelar). */
    id: string;
    source?: HttpRequestSource;
}

const DEFAULT_CONTENT_TYPES = {
    json: 'application/json',
    text: 'text/plain',
    xml: 'application/xml',
    'form-urlencoded': 'application/x-www-form-urlencoded'
} as const;

const enabled = <T extends KeyValue>(items: readonly T[]): T[] => items.filter((item) => item.enabled && item.key.trim());

const encodePairs = (items: readonly KeyValue[]): string => items.map(({ key, value }) => `${encodeURIComponent(key.trim())}=${encodeURIComponent(value)}`).join('&');

/** Base64 de texto UTF-8 (o `btoa` puro só aceita Latin-1). Funciona no main e no renderer. */
function base64(text: string): string {
    let binary = '';

    for (const byte of new TextEncoder().encode(text)) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary);
}

/** Como no Bruno/Postman, `api.local/x` vira `http://api.local/x`. */
function withScheme(url: string): string {
    return !url || /^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `http://${url}`;
}

function appendQuery(url: string, query: string): string {
    if (!query) {
        return url;
    }

    const hashIndex = url.indexOf('#');
    const [base, hash] = hashIndex >= 0 ? [url.slice(0, hashIndex), url.slice(hashIndex)] : [url, ''];
    const separator = !base.includes('?') ? '?' : base.endsWith('?') || base.endsWith('&') ? '' : '&';

    return `${base}${separator}${query}${hash}`;
}

/** Headers sem diferenciar maiúsculas/minúsculas: o último valor vence, mantendo a grafia dele. */
class HeaderBag {
    private readonly entries = new Map<string, [string, string]>();

    set(key: string, value: string): void {
        this.entries.set(key.toLowerCase(), [key, value]);
    }

    has(key: string): boolean {
        return this.entries.has(key.toLowerCase());
    }

    toRecord(): Record<string, string> {
        return Object.fromEntries(this.entries.values());
    }
}

/**
 * Converte o arquivo da coleção numa requisição executável: params e headers
 * habilitados, autenticação e corpo com `Content-Type` padrão quando ausente.
 * A interpolação de `{{variáveis}}` acontece antes (`interpolateRequest`).
 * Métodos sem corpo (GET, HEAD...) ignoram o body salvo.
 */
export function buildHttpRequest(definition: RequestDefinition, options: BuildRequestOptions): HttpRequest {
    const headers = new HeaderBag();
    const query = [...enabled(definition.params)];
    let body: string | undefined;
    let bodyFile: string | undefined;
    let multipart: HttpMultipartPart[] | undefined;
    let wsse: HttpRequest['wsse'];

    for (const { key, value } of enabled(definition.headers)) {
        headers.set(key.trim(), value);
    }

    const { auth } = definition;

    switch (auth.type) {
        case 'bearer':
            headers.set('Authorization', `Bearer ${auth.token}`);
            break;
        case 'basic':
            headers.set('Authorization', `Basic ${base64(`${auth.username}:${auth.password}`)}`);
            break;
        case 'apikey':
            if (auth.key.trim()) {
                if (auth.in === 'query') {
                    query.push({ key: auth.key, value: auth.value, enabled: true });
                } else {
                    headers.set(auth.key.trim(), auth.value);
                }
            }
            break;
        case 'wsse':
            // O digest depende de nonce e horário: é gerado pelo main no envio.
            wsse = { username: auth.username, password: auth.password };
            break;
        // `inherit` depende da autenticação da coleção (Etapa 8); `none` não envia nada.
    }

    const definitionBody = hasBody(definition.method) ? definition.body : ({ type: 'none' } as const);

    switch (definitionBody.type) {
        case 'none':
            break;
        case 'multipart-form':
            // Content-Type (com boundary) é definido pelo main ao montar o FormData.
            multipart = enabled(definitionBody.fields).map((field) => ({ name: field.key.trim(), value: field.value, file: field.kind === 'file' }));
            break;
        case 'binary':
            if (definitionBody.file) {
                bodyFile = definitionBody.file;
            }
            break;
        default:
            body = definitionBody.type === 'form-urlencoded' ? encodePairs(enabled(definitionBody.fields)) : definitionBody.content;

            if (!headers.has('content-type')) {
                headers.set('Content-Type', DEFAULT_CONTENT_TYPES[definitionBody.type]);
            }
    }

    return {
        id: options.id,
        method: definition.method,
        url: appendQuery(withScheme(definition.url.trim()), encodePairs(query)),
        headers: headers.toRecord(),
        ...(body !== undefined && { body }),
        ...(bodyFile && { bodyFile }),
        ...(multipart && { multipart }),
        ...(wsse && { wsse }),
        ...(options.source && { source: options.source })
    };
}
