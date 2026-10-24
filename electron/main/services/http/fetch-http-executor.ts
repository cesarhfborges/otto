import { request as httpRequest, STATUS_CODES, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fetch, FormData, request as undiciRequest, type Dispatcher } from 'undici';
import { DEFAULT_SETTINGS, hasBody, MAX_RESPONSE_BYTES, type HttpRequest, type HttpResponse, type HttpResult, type HttpSettings } from '../../../shared/models';
import type { IHttpExecutor } from '../../core/contracts';
import { digestAuthorization, findChallenge } from './auth/digest';
import { authenticateMessage, negotiateMessage } from './auth/ntlm';
import { OAuth2TokenProvider, type CachedToken, type OAuth2Authorizer } from './auth/oauth2';
import { signAsap, signAwsV4, signHawk, signNetrc, signOAuth1, signWsse } from './auth/signers';
import { clientCertificateFor, DispatcherProvider } from './dispatcher-provider';
import { RequestTrace } from './request-trace';

export interface FetchHttpExecutorOptions {
    /** Preferências lidas a cada execução (mudanças valem para a próxima requisição). */
    settings?: () => HttpSettings;
    dispatchers?: DispatcherProvider;
    /** Enviado quando a requisição não define `User-Agent`. */
    userAgent?: string;
    maxResponseBytes?: number;
    /** Janela de login do OAuth 2.0 (Authorization Code / Implicit). */
    oauth2Authorizer?: OAuth2Authorizer;
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

/** Erro com código próprio (`TIMEOUT`, `CANCELLED`...), para a interface sugerir o que fazer. */
function codedError(message: string, code: string): Error {
    return Object.assign(new Error(message), { code });
}

function describeError(error: unknown, signal: AbortSignal): { message: string; code?: string } {
    const failure = signal.aborted ? signal.reason : error;

    if (failure instanceof Error) {
        // Erros de rede do undici trazem o motivo real em `cause` (`connect ECONNREFUSED 127.0.0.1:3000`, certificado...).
        const cause = failure.cause as { code?: string; message?: string } | undefined;
        const code = cause?.code ?? (failure as NodeJS.ErrnoException).code;
        const message = cause?.message ?? failure.message;

        if (code && CERTIFICATE_ERRORS.has(code)) {
            return { message: `${message} (${code}). Add the CA certificate or turn off certificate verification in Preferences → Certificates.`, code };
        }

        return { message, code };
    }

    return { message: signal.aborted ? 'Request aborted' : String(failure) };
}

/** Credenciais embutidas na URL do proxy não aparecem no console. */
function redactCredentials(raw: string): string {
    try {
        const url = new URL(raw);

        if (url.username || url.password) {
            url.username = '***';
            url.password = '';
        }

        return url.toString();
    } catch {
        return raw;
    }
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
    trace: RequestTrace;
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

/** Descarta o corpo de uma resposta intermediária (desafio 401), liberando a conexão. */
async function drain(body: AsyncIterable<Uint8Array> | null): Promise<void> {
    if (body) {
        for await (const _ of body) {
            // Só consome.
        }
    }
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
function sendConnect({ url, headers, settings, signal, trace }: SendContext): Promise<RawResponse> {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    // Alvo do túnel: o caminho da URL, se for `host:porta`; senão, o próprio host.
    const target = /^\/?[^/]+:\d+$/.test(url.pathname) ? url.pathname.replace(/^\//, '') : `${url.hostname}:${port}`;

    return new Promise((resolve, reject) => {
        const req = send({
            method: 'CONNECT',
            host: url.hostname,
            port,
            path: target,
            headers: Object.fromEntries(headers),
            signal,
            rejectUnauthorized: settings.ssl.verifyCertificates
        });

        req.on('socket', (socket) => socket.once('connect', () => trace.info(`Connected to ${url.hostname} (${socket.remoteAddress ?? 'unknown address'}) port ${port}`)));
        req.on('connect', (res, socket) => {
            socket.destroy();

            const raw: RawResponse = { url: url.toString(), redirected: false, status: res.statusCode ?? 0, statusText: res.statusMessage ?? '', headers: flattenHeaders(res.headers), body: null };

            trace.responseHead('HTTP/1.1', raw.status, raw.statusText, raw.headers);
            trace.info('Tunnel established, closing it');
            resolve(raw);
        });
        req.on('response', (res) => {
            const raw: RawResponse = { url: url.toString(), redirected: false, status: res.statusCode ?? 0, statusText: res.statusMessage ?? '', headers: flattenHeaders(res.headers), body: res };

            trace.responseHead('HTTP/1.1', raw.status, raw.statusText, raw.headers);
            resolve(raw);
        });
        req.on('error', reject);
        trace.info(`Trying ${url.hostname}:${port}...`);
        trace.requestHead([`CONNECT ${target} HTTP/1.1`, `host: ${target}`, ...[...headers].map(([name, value]) => `${name}: ${value}`)]);
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
    private readonly oauth2: OAuth2TokenProvider;

    constructor(options: FetchHttpExecutorOptions = {}) {
        this.settings = options.settings ?? (() => DEFAULT_SETTINGS.http);
        this.dispatchers = options.dispatchers ?? new DispatcherProvider();
        this.userAgent = options.userAgent;
        this.maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
        this.oauth2 = new OAuth2TokenProvider(options.oauth2Authorizer);
    }

    async execute(request: HttpRequest): Promise<HttpResult> {
        const settings = this.settings();
        const timeoutMs = request.timeoutMs ?? settings.timeoutMs;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let started = performance.now();
        const elapsed = () => Math.round(performance.now() - started);
        const trace = new RequestTrace();

        this.inFlight.set(request.id, controller);
        trace.info(`Preparing request to ${request.url}`);
        trace.info(`Current time is ${new Date().toISOString()}`);

        try {
            const response = await trace.run(async () => {
                // O token OAuth 2.0 pode depender do login do usuário: o timeout só começa depois.
                const oauth2Token = request.auth?.type === 'oauth2' ? await this.oauth2.token(request.auth, this.dispatchers.get(settings), controller.signal, (text) => trace.info(text)) : undefined;

                // `0` desativa o timeout.
                timer = timeoutMs > 0 ? setTimeout(() => controller.abort(codedError(`Request timed out after ${timeoutMs} ms`, 'TIMEOUT')), timeoutMs) : undefined;
                started = performance.now();

                return this.send(request, settings, timeoutMs, controller.signal, trace, elapsed, oauth2Token);
            });

            trace.info(`Received ${response.size} B${response.truncated ? ' (truncated)' : ''}`);

            if (trace.connection) {
                trace.info(`Connection #${trace.connection.id} to host ${trace.connection.host} left intact`);
            }

            return { ok: true, response, timeline: trace.entries };
        } catch (error) {
            const { message, code } = describeError(error, controller.signal);

            trace.error(message);

            return { ok: false, error: message, ...(code ? { code } : {}), timeMs: elapsed(), timeline: trace.entries };
        } finally {
            clearTimeout(timer);
            this.inFlight.delete(request.id);
        }
    }

    private async send(request: HttpRequest, settings: HttpSettings, timeoutMs: number, signal: AbortSignal, trace: RequestTrace, elapsed: () => number, oauth2Token?: CachedToken): Promise<HttpResponse> {
        let url: URL;

        try {
            url = new URL(request.url);
        } catch {
            throw codedError(`Invalid URL: ${request.url}`, 'ERR_INVALID_URL');
        }

        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw codedError(`Unsupported protocol "${url.protocol}". Use http:// or https://`, 'UNSUPPORTED_PROTOCOL');
        }

        trace.info(timeoutMs > 0 ? `Enable timeout of ${timeoutMs}ms` : 'Timeout disabled');

        if (url.protocol === 'https:') {
            trace.info(settings.ssl.verifyCertificates ? 'Enable SSL validation' : 'Disable SSL validation');
        }

        trace.info(settings.followRedirects ? 'Enable following redirects' : 'Disable following redirects');

        if (settings.proxy.enabled && settings.proxy.url) {
            trace.info(`Using proxy ${redactCredentials(settings.proxy.url)}${settings.proxy.bypass ? ` (bypass: ${settings.proxy.bypass})` : ''}`);
        }

        const clientCertificate = clientCertificateFor(settings.ssl.clientCertificates, url);

        if (clientCertificate && url.protocol === 'https:') {
            trace.info(`Using client certificate for ${clientCertificate.host} (${clientCertificate.pfxPath ?? clientCertificate.certPath})`);
        }

        const dispatcher: Dispatcher = this.dispatchers.get(settings);
        const headers = new Headers(request.headers);

        if (this.userAgent && !headers.has('user-agent')) {
            headers.set('user-agent', this.userAgent);
        }

        const body = hasBody(request.method) ? await buildBody(request, headers) : undefined;

        trace.describeBody(body, request.bodyFile);

        const context: SendContext = { url, method: request.method, headers, body, settings, signal, dispatcher, trace };
        let dedicated: Dispatcher | undefined;

        try {
            if (request.auth?.type === 'ntlm') {
                // O handshake NTLM autentica a conexão: as 3 mensagens precisam usar o mesmo socket.
                dedicated = this.dispatchers.dedicated(settings, url);
                context.dispatcher = dedicated;
                trace.info('NTLM: using a dedicated connection (proxy settings do not apply)');
            }

            if (request.auth) {
                await this.authenticate(request.auth, context, oauth2Token);
            }

            const res = await this.dispatchAuthenticated(request, context);
            const ttfbMs = elapsed();
            const { bytes, truncated } = await readBody(res.body, this.maxResponseBytes);
            const totalMs = elapsed();

            return this.toResponse(res, bytes, truncated, ttfbMs, totalMs);
        } finally {
            dedicated?.close().catch(() => undefined);
        }
    }

    /** Autenticações aplicadas antes do primeiro envio. */
    private async authenticate(auth: NonNullable<HttpRequest['auth']>, context: SendContext, oauth2Token?: CachedToken): Promise<void> {
        switch (auth.type) {
            case 'wsse':
                return signWsse(context, auth);
            case 'oauth1':
                return signOAuth1(context, auth);
            case 'awsv4':
                return signAwsV4(context, auth);
            case 'hawk':
                return signHawk(context, auth);
            case 'asap':
                return signAsap(context, auth);
            case 'oauth2':
                if (oauth2Token) {
                    OAuth2TokenProvider.apply(auth, oauth2Token, context);
                }
                return;
            case 'netrc': {
                const file = await signNetrc(context);

                context.trace.info(file ? `Using credentials for ${context.url.hostname} from ${file}` : `No .netrc credentials found for ${context.url.hostname}`);
                return;
            }
            case 'ntlm':
                context.headers.set('authorization', negotiateMessage());
                return;
            case 'digest':
                // Só depois do desafio do servidor (401).
                return;
        }
    }

    /** Envia e, se o servidor desafiar (401 Digest/NTLM), responde e reenvia. */
    private async dispatchAuthenticated(request: HttpRequest, context: SendContext): Promise<RawResponse> {
        const dispatch = (): Promise<RawResponse> => (request.method === 'CONNECT' ? sendConnect(context) : request.method === 'TRACE' ? sendWithRequest(context) : sendWithFetch(context));
        const res = await dispatch();
        const { auth } = request;

        if (res.status !== 401 || (auth?.type !== 'digest' && auth?.type !== 'ntlm')) {
            return res;
        }

        const challenge = findChallenge(res.headers, auth.type === 'digest' ? 'Digest' : 'NTLM');

        // `NTLM` sem mensagem = credenciais recusadas; sem desafio, devolve o 401 como está.
        if (!challenge || (auth.type === 'ntlm' && !/^NTLM\s+\S/i.test(challenge))) {
            return res;
        }

        await drain(res.body);

        if (auth.type === 'digest') {
            const target = new URL(res.url || context.url.toString());

            context.trace.info('Digest challenge received, sending credentials');
            context.headers.set(
                'authorization',
                digestAuthorization(challenge, { username: auth.username, password: auth.password, method: request.method, uri: `${target.pathname}${target.search}`, ...(typeof context.body === 'string' && { body: context.body }) })
            );
        } else {
            context.trace.info('NTLM challenge received, sending credentials');
            context.headers.set('authorization', authenticateMessage(challenge, auth));
        }

        return dispatch();
    }

    private toResponse(res: RawResponse, bytes: Uint8Array, truncated: boolean, ttfbMs: number, totalMs: number): HttpResponse {
        const contentType = res.headers.find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? null;
        const textual = isTextual(contentType);

        return {
            url: res.url,
            redirected: res.redirected,
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
            contentType,
            body: textual ? decodeText(bytes, contentType) : Buffer.from(bytes).toString('base64'),
            bodyEncoding: textual ? 'utf8' : 'base64',
            size: bytes.byteLength,
            headersSize: headersSize(res.status, res.statusText, res.headers),
            truncated,
            timeMs: totalMs,
            timings: { ttfbMs, downloadMs: totalMs - ttfbMs, totalMs }
        };
    }

    cancel(requestId: string): boolean {
        const controller = this.inFlight.get(requestId);

        controller?.abort(codedError('Request cancelled', 'CANCELLED'));

        return !!controller;
    }

    /** Fecha as conexões abertas (ao encerrar o app). */
    async dispose(): Promise<void> {
        for (const controller of this.inFlight.values()) {
            controller.abort(codedError('Request cancelled', 'CANCELLED'));
        }

        await this.dispatchers.close();
    }
}
