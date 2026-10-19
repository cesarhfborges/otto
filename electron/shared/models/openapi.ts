import type { IsoDateTime } from './common';
import type { HttpMethod } from './http';
import type { RequestDefinition } from './request';

export const OPENAPI_CHECK_INTERVALS = [5, 15, 30, 60] as const;

export type OpenApiCheckInterval = (typeof OPENAPI_CHECK_INTERVALS)[number];

export const OPENAPI_GROUPINGS = ['tags', 'path'] as const;

export type OpenApiGrouping = (typeof OPENAPI_GROUPINGS)[number];

/** Ligação da coleção com um spec OpenAPI/Swagger (gravada no `otto.yaml`). */
export interface OpenApiConfig {
    source: { type: 'url' | 'file'; location: string };
    autoCheck: boolean;
    intervalMinutes: OpenApiCheckInterval;
    /** Pastas das requisições geradas: pela primeira tag da operação ou pelo primeiro segmento do caminho. */
    groupBy: OpenApiGrouping;
}

/** Resumo do spec lido. */
export interface OpenApiSpecInfo {
    title: string;
    /** `info.version` do spec. */
    version: string;
    /** Versão do formato (`3.0.3`, `2.0`...). */
    format: string;
    servers: string[];
    endpointCount: number;
}

export type EndpointChangeKind = 'added' | 'modified' | 'removed';

/** Diferença de um endpoint (identificado por `MÉTODO caminho`). */
export interface EndpointChange {
    key: string;
    method: HttpMethod;
    path: string;
    operationId: string | null;
    kind: EndpointChangeKind;
    /** Lado esquerdo do diff (spec updates: a coleção hoje; collection changes: o último spec sincronizado). */
    before: RequestDefinition | null;
    /** Lado direito (spec updates: o spec novo; collection changes: a coleção hoje). */
    after: RequestDefinition | null;
    /** Arquivo da requisição na coleção, quando existe. */
    requestPath: string | null;
}

export interface OpenApiStatus {
    config: OpenApiConfig | null;
    spec: OpenApiSpecInfo | null;
    /** Falha ao buscar/ler o spec (rede, arquivo ausente, formato inválido). */
    error: string | null;
    lastCheckedAt: IsoDateTime | null;
    lastSyncedAt: IsoDateTime | null;
    syncedSpecVersion: string | null;
    /** Requisições da coleção ligadas a operações do spec. */
    linkedRequests: number;
    inSync: number;
    /** Spec novo × último sincronizado. */
    specUpdates: EndpointChange[];
    /** Coleção × último sincronizado (edições locais). */
    collectionChanges: EndpointChange[];
}
