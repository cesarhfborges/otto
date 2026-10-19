import type { HttpRequest, HttpResult, NewHistoryEntry } from '../../../shared/models';
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
            url: redactUrl(request.url),
            status: result.ok ? result.response.status : null,
            error: result.ok ? null : result.error,
            timeMs: result.ok ? result.response.timeMs : result.timeMs,
            sizeBytes: result.ok ? result.response.size : 0
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
