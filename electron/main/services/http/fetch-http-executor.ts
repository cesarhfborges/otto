import { DEFAULT_SETTINGS, type HttpRequest, type HttpResult, type HttpSettings } from '../../../shared/models';
import type { IHttpExecutor } from '../../core/contracts';

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

/**
 * Executor baseado no `fetch` nativo do Node (undici).
 * Timeout e redirecionamentos vêm das preferências globais (`http.*`), lidas a cada execução.
 * Proxy e SSL ainda não são aplicados (Etapa 5, via `undici` Agent/ProxyAgent).
 */
export class FetchHttpExecutor implements IHttpExecutor {
    private readonly inFlight = new Map<string, AbortController>();

    constructor(private readonly settings: () => HttpSettings = () => DEFAULT_SETTINGS.http) {}

    async execute(request: HttpRequest): Promise<HttpResult> {
        const { timeoutMs: defaultTimeoutMs, followRedirects } = this.settings();
        const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
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

            const canHaveBody = request.method !== 'GET' && request.method !== 'HEAD';
            const res = await fetch(url, {
                method: request.method,
                headers: request.headers,
                body: canHaveBody ? request.body : undefined,
                redirect: followRedirects ? 'follow' : 'manual',
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
            this.inFlight.delete(request.id);
        }
    }

    cancel(requestId: string): boolean {
        const controller = this.inFlight.get(requestId);

        controller?.abort(new Error('Request cancelled'));

        return !!controller;
    }
}
