/** Identificador opaco (UUID v4 gerado no main ou no renderer). */
export type EntityId = string;

/** Data/hora em ISO 8601 (UTC), serializável via IPC e SQLite. */
export type IsoDateTime = string;

/** Par chave/valor editável na UI (headers, query params, variáveis). */
export interface KeyValue {
    key: string;
    value: string;
    /** Itens desabilitados ficam salvos, mas não são enviados/interpolados. */
    enabled: boolean;
}

export interface Timestamps {
    createdAt: IsoDateTime;
    updatedAt: IsoDateTime;
}
