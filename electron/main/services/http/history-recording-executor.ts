import { MAX_HISTORY_BODY_CHARS, SECRET_MASK, type HistoryDetail, type HttpRequest, type HttpResult, type NewHistoryEntry } from '../../../shared/models';
import type { IHistoryRepository, IHttpExecutor } from '../../core/contracts';

export interface HistoryRecordingOptions {
    /** Retenção lida a cada execução (`history.maxEntries`); `0` desliga o registro. */
    maxEntries: () => number;
    /** Chamado após gravar (ex.: emitir `history:changed`). */
    onRecorded?: () => void;
    /** Erros de gravação não afetam a resposta; só são reportados. */
    onError?: (error: unknown) => void;
}

/** Não guarda usuário/senha embutidos na URL (`https://user:pass@host`). */
function redactUrl(raw: string): string {
    try {
        const url = new URL(raw);

        if (!url.username && !url.password) {
            return raw;
        }

        url.username = '';
        url.password = '';

        return url.toString();
    } catch {
        return raw;
    }
}

/** Troca cada valor secreto (os mais longos primeiro, para não sobrar pedaço) pela máscara. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
    return secrets.reduce((result, secret) => (secret ? result.split(secret).join(SECRET_MASK) : result), text);
}

/** Headers de credencial são sempre mascarados (ex.: Basic em base64, que não casa com o valor da variável). */
const CREDENTIAL_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie']);

const bodyText = (text: string | undefined, secrets: readonly string[]): string | null => (text === undefined || text.length > MAX_HISTORY_BODY_CHARS ? null : redactSecrets(text, secrets));

/** Requisição e resposta guardadas no histórico, sem os valores secretos. */
function historyDetail(request: HttpRequest, result: HttpResult): HistoryDetail {
    // Valores curtos demais mascarariam trechos comuns do texto (ex.: "1", "a").
    const secrets = [...new Set(request.redact ?? [])].filter((secret) => secret.length >= 3).sort((a, b) => b.length - a.length);
    const redact = (text: string): string => redactSecrets(text, secrets);

    return {
        request: {
            method: request.method,
            url: redact(redactUrl(request.url)),
            headers: Object.entries(request.headers ?? {}).map(([name, value]) => [name, CREDENTIAL_HEADERS.has(name.toLowerCase()) ? SECRET_MASK : redact(value)]),
            body: bodyText(request.body, secrets)
        },
        response: result.ok
            ? {
                  status: result.response.status,
                  statusText: result.response.statusText,
                  headers: result.response.headers.map(([name, value]) => [name, redact(value)]),
                  contentType: result.response.contentType,
                  body: result.response.bodyEncoding === 'utf8' ? bodyText(result.response.body, secrets) : null
              }
            : null
    };
}

/**
 * Decorator (OCP): registra cada execução no histórico do SQLite sem alterar o executor base.
 * Requisições canceladas e com erro também entram (status `null` + mensagem).
 */
export class HistoryRecordingExecutor implements IHttpExecutor {
    constructor(
        private readonly inner: IHttpExecutor,
        private readonly history: IHistoryRepository,
        private readonly options: HistoryRecordingOptions
    ) {}

    async execute(request: HttpRequest): Promise<HttpResult> {
        const result = await this.inner.execute(request);
        const maxEntries = this.options.maxEntries();

        if (maxEntries > 0) {
            this.record(request, result, maxEntries);
        }

        return result;
    }

    cancel(requestId: string): boolean {
        return this.inner.cancel(requestId);
    }

    private record(request: HttpRequest, result: HttpResult, maxEntries: number): void {
        const entry: NewHistoryEntry = {
            collectionId: request.source?.collectionId ?? null,
            requestPath: request.source?.requestPath ?? null,
            method: request.method,
            url: redactSecrets(redactUrl(request.url), request.redact?.filter((secret) => secret.length >= 3) ?? []),
            status: result.ok ? result.response.status : null,
            error: result.ok ? null : result.error,
            timeMs: result.ok ? result.response.timeMs : result.timeMs,
            sizeBytes: result.ok ? result.response.size : 0,
            detail: historyDetail(request, result)
        };

        try {
            try {
                this.history.add(entry);
            } catch {
                // A coleção de origem pode ter sido removida no meio do caminho (FK): grava sem vínculo.
                this.history.add({ ...entry, collectionId: null, requestPath: null });
            }

            this.history.prune(maxEntries);
            this.options.onRecorded?.();
        } catch (error) {
            this.options.onError?.(error);
        }
    }
}
