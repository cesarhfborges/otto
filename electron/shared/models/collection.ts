import type { EntityId, IsoDateTime, KeyValue, Timestamps } from './common';
import type { OpenApiConfig } from './openapi';
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

/** Versão do formato em disco (`otto.yaml`). */
export const COLLECTION_FORMAT_VERSION = 1;

/** Conteúdo do `otto.yaml` na raiz da coleção. */
export interface CollectionManifest {
    version: number;
    name: string;
    description: string;
    /** Headers enviados em todas as requisições da coleção; os da requisição têm prioridade. */
    headers: KeyValue[];
    openapi: OpenApiConfig | null;
}

/** Alteração editável pela UI no `otto.yaml`. */
export type CollectionManifestPatch = Partial<Pick<CollectionManifest, 'description' | 'headers'>>;

/** Nó da árvore de uma coleção lida do disco. */
export type CollectionNode = CollectionFolderNode | CollectionRequestNode;

export interface CollectionFolderNode {
    type: 'folder';
    name: string;
    /** Caminho relativo à raiz da coleção, sempre com `/`. */
    path: string;
    children: CollectionNode[];
}

export interface CollectionRequestNode {
    type: 'request';
    /** Nome da requisição (do arquivo) ou o nome do arquivo, se ilegível. */
    name: string;
    path: string;
    /** `null` quando o arquivo não pôde ser lido como requisição. */
    method: HttpMethod | null;
    seq: number | null;
    /** Motivo pelo qual o arquivo é inválido, se for o caso. */
    error: string | null;
}

export interface CollectionTree {
    root: string;
    name: string;
    children: CollectionNode[];
}

/** Coleção aberta: metadados do banco + manifesto e árvore lidos do disco. */
export interface OpenedCollection {
    metadata: CollectionMetadata;
    manifest: CollectionManifest;
    tree: CollectionTree;
}

/** Formatos de exportação: backup completo do Otto (.zip com ambientes) ou spec OpenAPI 3. */
export const COLLECTION_EXPORT_FORMATS = ['backup', 'openapi'] as const;

export type CollectionExportFormat = (typeof COLLECTION_EXPORT_FORMATS)[number];

/** O que importar: um backup do Otto (.zip) ou um spec OpenAPI/Swagger (URL ou arquivo). */
export type CollectionImportRequest =
    | { type: 'backup'; file: string }
    | {
          type: 'openapi';
          source: OpenApiConfig['source'];
          /** Liga a verificação automática de atualizações do spec. */
          autoSync: boolean;
      };
