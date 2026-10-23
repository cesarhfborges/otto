import type { EntityId, IsoDateTime } from './common';

/** Porta padrão sugerida ao iniciar o mock de uma coleção. */
export const DEFAULT_MOCK_PORT = 4010;

/** Uma chamada recebida pelo mock server. */
export interface MockHit {
    at: IsoDateTime;
    method: string;
    path: string;
    status: number;
    /** Requisição da coleção que respondeu; `null` quando nenhuma rota casou. */
    requestPath: string | null;
    example: string | null;
}

/** Mock server de uma coleção, escutando só em `127.0.0.1`. */
export interface MockServerStatus {
    collectionId: EntityId;
    port: number;
    url: string;
    /** Quantas rotas (requisições com exemplos) estão sendo servidas. */
    routes: number;
    /** Chamadas mais recentes primeiro. */
    hits: MockHit[];
}
