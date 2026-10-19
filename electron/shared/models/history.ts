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

export type NewHistoryEntry = Omit<HistoryEntry, 'id' | 'executedAt'>;

export interface HistoryQuery {
    limit?: number;
    offset?: number;
    collectionId?: EntityId;
}
