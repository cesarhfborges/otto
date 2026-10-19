import type { EntityId, IsoDateTime, Timestamps } from './common';
import type { HttpMethod } from './http';

/** Origem remota da coleção (ex.: spec OpenAPI), usada pela sincronização. */
export interface CollectionSource {
    kind: 'openapi';
    /** URL ou caminho local da especificação. */
    location: string;
    /** Hash do último conteúdo sincronizado, para detectar mudanças. */
    lastHash: string | null;
    lastCheckedAt: IsoDateTime | null;
}

/** Metadados de uma coleção conhecida pelo app (o conteúdo vive no disco). */
export interface CollectionMetadata extends Timestamps {
    id: EntityId;
    name: string;
    /** Pasta raiz da coleção no sistema de arquivos. */
    path: string;
    source: CollectionSource | null;
    lastOpenedAt: IsoDateTime | null;
}

export type NewCollectionMetadata = Omit<CollectionMetadata, 'id' | keyof Timestamps>;

/** Nó da árvore de uma coleção lida do disco. */
export type CollectionNode = CollectionFolderNode | CollectionRequestNode;

export interface CollectionFolderNode {
    type: 'folder';
    name: string;
    /** Caminho relativo à raiz da coleção. */
    path: string;
    children: CollectionNode[];
}

export interface CollectionRequestNode {
    type: 'request';
    name: string;
    path: string;
    method: HttpMethod;
}

export interface CollectionTree {
    root: string;
    name: string;
    children: CollectionNode[];
}
