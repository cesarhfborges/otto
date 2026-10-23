import type { EntityId, IsoDateTime } from './common';
import type { HttpMethod } from './http';

/** Registro de uma requisição executada (persistido no SQLite). */
export interface HistoryEntry {
    id: EntityId;
    /** Coleção/requisição de origem, quando a chamada partiu de um arquivo salvo. */
    collectionId: EntityId | null;
    requestPath: string | null;
    method: HttpMethod;
    url: string;
    /** `null` quando a requisição falhou antes de receber resposta (rede, timeout, cancelamento). */
    status: number | null;
    error: string | null;
    timeMs: number;
    sizeBytes: number;
    executedAt: IsoDateTime;
}

/** Corpos maiores que isto não são guardados no histórico (só os metadados). */
export const MAX_HISTORY_BODY_CHARS = 512 * 1024;

/** Requisição e resposta gravadas (segredos mascarados), para rever e comparar execuções. */
export interface HistoryDetail {
    request: {
        method: HttpMethod;
        url: string;
        headers: Array<[string, string]>;
        /** `null` sem corpo em texto (arquivo, multipart) ou acima de `MAX_HISTORY_BODY_CHARS`. */
        body: string | null;
    };
    response: {
        status: number;
        statusText: string;
        headers: Array<[string, string]>;
        contentType: string | null;
        /** `null` para conteúdo binário ou acima de `MAX_HISTORY_BODY_CHARS`. */
        body: string | null;
    } | null;
}

export interface HistoryEntryWithDetail extends HistoryEntry {
    /** `null` em registros anteriores ao armazenamento de detalhes. */
    detail: HistoryDetail | null;
}

export type NewHistoryEntry = Omit<HistoryEntry, 'id' | 'executedAt'> & { detail?: HistoryDetail | null };

export interface HistoryQuery {
    limit?: number;
    offset?: number;
    collectionId?: EntityId;
    /** Só as execuções de um arquivo da coleção (exige `collectionId`). */
    requestPath?: string;
}

/** Escopo de `history.clear`: sem campos apaga tudo. */
export type HistoryScope = Pick<HistoryQuery, 'collectionId' | 'requestPath'>;

/** Texto colocado no lugar de valores secretos (histórico, exportações). */
export const SECRET_MASK = '••••••';
