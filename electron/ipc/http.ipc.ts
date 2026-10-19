import type { HttpMethod, HttpRequest, HttpResult } from '../shared/contract';
import { handle } from './handle';

/**
 * As requisições são executadas no processo main (fetch do Node/undici) e não no
 * renderer: assim não há CORS e temos controle total sobre headers e tempos.
 */

const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const DEFAULT_TIMEOUT_MS = 30_000;

const inFlight = new Map<string, AbortController>();

function parseRequest(raw: unknown): HttpRequest {
    if (!raw || typeof raw !== 'object') {
        throw new Error('Invalid request');
    }

    const req = raw as Record<string, unknown>;

    if (typeof req['id'] !== 'string' || !req['id']) {
        throw new Error('Request id is required');
    }

    if (!METHODS.includes(req['method'] as HttpMethod)) {
        throw new Error(`Unsupported method: ${String(req['method'])}`);
    }

    if (typeof req['url'] !== 'string') {
        throw new Error('Request URL is required');
    }

    const headers: Record<string, string> = {};

    if (req['headers'] && typeof req['headers'] === 'object') {
        for (const [key, value] of Object.entries(req['headers'] as Record<string, unknown>)) {
            if (typeof value === 'string' && key.trim()) {
                headers[key.trim()] = value;
            }
        }
    }

    return {
        id: req['id'],
        method: req['method'] as HttpMethod,
        url: req['url'].trim(),
        headers,
        body: typeof req['body'] === 'string' ? req['body'] : undefined,
        timeoutMs: typeof req['timeoutMs'] === 'number' && req['timeoutMs'] > 0 ? req['timeoutMs'] : DEFAULT_TIMEOUT_MS
    };
}

function describeError(error: unknown, signal: AbortSignal): string {
    if (signal.aborted) {
        return signal.reason instanceof Error ? signal.reason.message : 'Request aborted';
    }

    if (error instanceof Error) {
        // Erros de rede do undici trazem o motivo real em `cause` (ECONNREFUSED, ENOTFOUND, certificado...).
        const cause = error.cause as { code?: string; message?: string } | undefined;
        const detail = cause?.code ?? cause?.message;

        return detail ? `${error.message}: ${detail}` : error.message;
    }

    return String(error);
}

async function send(request: HttpRequest): Promise<HttpResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${request.timeoutMs} ms`)), request.timeoutMs);
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);

    inFlight.set(request.id, controller);

    try {
        const url = new URL(request.url);

        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error(`Unsupported protocol: ${url.protocol}`);
        }

        const canHaveBody = request.method !== 'GET' && request.method !== 'HEAD';
        const res = await fetch(url, {
            method: request.method,
            headers: request.headers,
            body: canHaveBody ? request.body : undefined,
            redirect: 'follow',
            signal: controller.signal
        });
        const bytes = new Uint8Array(await res.arrayBuffer());

        return {
            ok: true,
            response: {
                url: res.url,
                status: res.status,
                statusText: res.statusText,
                headers: [...res.headers.entries()],
                body: new TextDecoder().decode(bytes),
                size: bytes.byteLength,
                timeMs: elapsed()
            }
        };
    } catch (error) {
        return { ok: false, error: describeError(error, controller.signal), timeMs: elapsed() };
    } finally {
        clearTimeout(timer);
        inFlight.delete(request.id);
    }
}

export function registerHttpIpc(): void {
    handle('http:send', (_event, raw) => send(parseRequest(raw)));

    handle('http:cancel', (_event, id) => {
        const controller = typeof id === 'string' ? inFlight.get(id) : undefined;

        controller?.abort(new Error('Request cancelled'));

        return !!controller;
    });
}
