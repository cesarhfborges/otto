import { request as httpRequest, STATUS_CODES, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fetch, FormData, request as undiciRequest, type Dispatcher } from 'undici';
import { DEFAULT_SETTINGS, hasBody, MAX_RESPONSE_BYTES, type HttpRequest, type HttpResponse, type HttpResult, type HttpSettings } from '../../../shared/models';
import type { IHttpExecutor } from '../../core/contracts';
import { DispatcherProvider } from './dispatcher-provider';

export interface FetchHttpExecutorOptions {
    /** Preferências lidas a cada execução (mudanças valem para a próxima requisição). */
    settings?: () => HttpSettings;
    dispatchers?: DispatcherProvider;
    /** Enviado quando a requisição não define `User-Agent`. */
    userAgent?: string;
    maxResponseBytes?: number;
}

const CERTIFICATE_ERRORS = new Set([
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'CERT_HAS_EXPIRED',
    'CERT_NOT_YET_VALID',
    'ERR_TLS_CERT_ALTNAME_INVALID'
]);

function describeError(error: unknown, signal: AbortSignal): string {
    if (signal.aborted) {
        return signal.reason instanceof Error ? signal.reason.message : 'Request aborted';
    }

    if (error instanceof Error) {
        // Erros de rede do undici trazem o motivo real em `cause` (ECONNREFUSED, ENOTFOUND, certificado...).
        const cause = error.cause as { code?: string; message?: string } | undefined;
        const detail = cause?.code ?? cause?.message;

        if (detail && CERTIFICATE_ERRORS.has(detail)) {
            return `${error.message}: ${detail}. Add the CA certificate or turn off certificate verification in Preferences → Certificates.`;
        }

        return detail ? `${error.message}: ${detail}` : error.message;
    }

    return String(error);
}

const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql|yaml|x-yaml|x-ndjson|csv|problem\+json)\b)|\+(json|xml)$/;

/** Sem `Content-Type`, assume texto (APIs costumam omitir em respostas simples). */
function isTextual(contentType: string | null): boolean {
    const mime = contentType?.split(';')[0]?.trim().toLowerCase();

    return !mime || TEXT_TYPES.test(mime);
}

function decodeText(bytes: Uint8Array, contentType: string | null): string {
    const charset = /charset="?([^;"\s]+)/i.exec(contentType ?? '')?.[1];

    try {
        return new TextDecoder(charset ?? 'utf-8').decode(bytes);
    } catch {
        return new TextDecoder().decode(bytes);
    }
}

/** Lê o corpo em streaming e para ao atingir o limite. */
async function readBody(body: AsyncIterable<Uint8Array> | null, limit: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
    if (!body) {
        return { bytes: new Uint8Array(), truncated: false };
    }

    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;

    // Sair do `for await` cancela o stream (não baixa o resto).
    for await (const value of body) {
        if (size + value.byteLength > limit) {
            chunks.push(value.subarray(0, limit - size));
            size = limit;
            truncated = true;
            break;
        }

        chunks.push(value);
        size += value.byteLength;
    }

    return { bytes: Buffer.concat(chunks, size), truncated };
}

/** Resposta ainda sem o corpo lido, comum aos três modos de envio. */
interface RawResponse {
    url: string;
    redirected: boolean;
    status: number;
    statusText: string;
    headers: Array<[string, string]>;
    body: AsyncIterable<Uint8Array> | null;
}

interface SendContext {
    url: URL;
    method: HttpRequest['method'];
    headers: Headers;
    body: string | Uint8Array | FormData | undefined;
    settings: HttpSettings;
    signal: AbortSignal;
    dispatcher: Dispatcher;
}

async function readBodyFile(file: string): Promise<Uint8Array> {
    try {
        return await readFile(file);
    } catch (error) {
        throw new Error(`Could not read the file "${file}" (${(error as NodeJS.ErrnoException).code ?? 'unknown error'})`);
    }
}

/** Corpo final: texto, arquivo (File/Binary) ou multipart (texto + arquivos lidos agora). */
async function buildBody(request: HttpRequest, headers: Headers): Promise<SendContext['body']> {
    if (request.bodyFile) {
        if (!headers.has('content-type')) {
            headers.set('content-type', 'application/octet-stream');
        }

        return readBodyFile(request.bodyFile);
    }

    if (request.multipart) {
        const form = new FormData();

        for (const part of request.multipart) {
            if (part.file) {
                form.append(part.name, new Blob([new Uint8Array(await readBodyFile(part.value))]), path.basename(part.value));
            } else {
                form.append(part.name, part.value);
            }
        }

        // O boundary é gerado pelo fetch; um Content-Type manual o quebraria.
        headers.delete('content-type');

        return form;
    }

    return request.body;
}

/** WSSE UsernameToken: digest = base64(sha1(nonce + created + senha)), gerado a cada envio. */
function applyWsse(headers: Headers, { username, password }: NonNullable<HttpRequest['wsse']>): void {
    const nonce = randomBytes(16);
    const created = new Date().toISOString();
    const digest = createHash('sha1')
        .update(Buffer.concat([nonce, Buffer.from(created + password, 'utf8')]))
        .digest('base64');

    headers.set('authorization', 'WSSE profile="UsernameToken"');
    headers.set('x-wsse', `UsernameToken Username="${username}", PasswordDigest="${digest}", Nonce="${nonce.toString('base64')}", Created="${created}"`);
}

const flattenHeaders = (headers: IncomingHttpHeaders): Array<[string, string]> =>
    Object.entries(headers).flatMap(([key, value]): Array<[string, string]> => (value === undefined ? [] : Array.isArray(value) ? value.map((v): [string, string] => [key, v]) : [[key, value]]));

async function sendWithFetch({ url, method, headers, body, settings, signal, dispatcher }: SendContext): Promise<RawResponse> {
    const res = await fetch(url, { method, headers, body, redirect: settings.followRedirects ? 'follow' : 'manual', signal, dispatcher });

    return { url: res.url, redirected: res.redirected, status: res.status, statusText: res.statusText, headers: [...res.headers.entries()], body: res.body };
}

/** TRACE é proibido no `fetch` (especificação), mas permitido na API `request` do undici. Não segue redirecionamentos. */
async function sendWithRequest({ url, method, headers, signal, dispatcher }: SendContext): Promise<RawResponse> {
    // TRACE não leva corpo.
    const res = await undiciRequest(url, { method, headers: Object.fromEntries(headers), signal, dispatcher });

    return { url: url.toString(), redirected: false, status: res.statusCode, statusText: STATUS_CODES[res.statusCode] ?? '', headers: flattenHeaders(res.headers), body: res.body };
}

/**
 * CONNECT pede ao servidor (normalmente um proxy) para abrir um túnel até `host:porta`.
 * Mostramos o status e os headers da resposta e fechamos o túnel em seguida.
 * As preferências de proxy não se aplicam: o destino da URL é o próprio proxy.
 */
function sendConnect({ url, headers, settings, signal }: SendContext): Promise<RawResponse> {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');

    return new Promise((resolve, reject) => {
        const req = send({
            method: 'CONNECT',
            host: url.hostname,
            port,
            // Alvo do túnel: o caminho da URL, se for `host:porta`; senão, o próprio host.
            path: /^\/?[^/]+:\d+$/.test(url.pathname) ? url.pathname.replace(/^\//, '') : `${url.hostname}:${port}`,
            headers: Object.fromEntries(headers),
            signal,
            rejectUnauthorized: settings.ssl.verifyCertificates
        });

        req.on('connect', (res, socket) => {
            socket.destroy();
            resolve({ url: url.toString(), redirected: false, status: res.statusCode ?? 0, statusText: res.statusMessage ?? '', headers: flattenHeaders(res.headers), body: null });
        });
        req.on('response', (res) => resolve({ url: url.toString(), redirected: false, status: res.statusCode ?? 0, statusText: res.statusMessage ?? '', headers: flattenHeaders(res.headers), body: res }));
        req.on('error', reject);
        req.end();
    });
}

const headersSize = (status: number, statusText: string, headers: Array<[string, string]>): number =>
    Buffer.byteLength(`HTTP/1.1 ${status} ${statusText}\r\n`) + headers.reduce((sum, [key, value]) => sum + Buffer.byteLength(`${key}: ${value}\r\n`), 2);

/**
 * Executor baseado no `fetch` do undici, com dispatcher próprio para proxy e SSL.
 * Timeout, redirecionamentos, proxy e certificados vêm das preferências globais (`http.*`).
 */
export class FetchHttpExecutor implements IHttpExecutor {
    private readonly inFlight = new Map<string, AbortController>();
    private readonly settings: () => HttpSettings;
    private readonly dispatchers: DispatcherProvider;
    private readonly userAgent: string | undefined;
    private readonly maxResponseBytes: number;

    constructor(options: FetchHttpExecutorOptions = {}) {
        this.settings = options.settings ?? (() => DEFAULT_SETTINGS.http);
        this.dispatchers = options.dispatchers ?? new DispatcherProvider();
        this.userAgent = options.userAgent;
        this.maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
    }

    async execute(request: HttpRequest): Promise<HttpResult> {
        const settings = this.settings();
        const timeoutMs = request.timeoutMs ?? settings.timeoutMs;
        const controller = new AbortController();
        // `0` desativa o timeout.
        const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs} ms`)), timeoutMs) : undefined;
        const started = performance.now();
        const elapsed = () => Math.round(performance.now() - started);

        this.inFlight.set(request.id, controller);

        try {
            const url = new URL(request.url);

            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                throw new Error(`Unsupported protocol: ${url.protocol}`);
            }

            const dispatcher: Dispatcher = this.dispatchers.get(settings);
            const headers = new Headers(request.headers);

            if (this.userAgent && !headers.has('user-agent')) {
                headers.set('user-agent', this.userAgent);
            }

            if (request.wsse) {
                applyWsse(headers, request.wsse);
            }

            const context: SendContext = { url, method: request.method, headers, body: hasBody(request.method) ? await buildBody(request, headers) : undefined, settings, signal: controller.signal, dispatcher };
            const res = await (request.method === 'CONNECT' ? sendConnect(context) : request.method === 'TRACE' ? sendWithRequest(context) : sendWithFetch(context));
            const ttfbMs = elapsed();
            const { bytes, truncated } = await readBody(res.body, this.maxResponseBytes);
            const totalMs = elapsed();
            const contentType = res.headers.find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? null;
            const textual = isTextual(contentType);
            const responseHeaders = res.headers;
            const response: HttpResponse = {
                url: res.url,
                redirected: res.redirected,
                status: res.status,
                statusText: res.statusText,
                headers: responseHeaders,
                contentType,
                body: textual ? decodeText(bytes, contentType) : Buffer.from(bytes).toString('base64'),
                bodyEncoding: textual ? 'utf8' : 'base64',
                size: bytes.byteLength,
                headersSize: headersSize(res.status, res.statusText, responseHeaders),
                truncated,
                timeMs: totalMs,
                timings: { ttfbMs, downloadMs: totalMs - ttfbMs, totalMs }
            };

            return { ok: true, response };
        } catch (error) {
            return { ok: false, error: describeError(error, controller.signal), timeMs: elapsed() };
        } finally {
            clearTimeout(timer);
            this.inFlight.delete(request.id);
        }
    }

    cancel(requestId: string): boolean {
        const controller = this.inFlight.get(requestId);

        controller?.abort(new Error('Request cancelled'));

        return !!controller;
    }

    /** Fecha as conexões abertas (ao encerrar o app). */
    async dispose(): Promise<void> {
        for (const controller of this.inFlight.values()) {
            controller.abort(new Error('Request cancelled'));
        }

        await this.dispatchers.close();
    }
}
