import type { EntityId, IsoDateTime, KeyValue, Timestamps } from './common';
import type { OpenApiConfig } from './openapi';
import type { HttpMethod } from './http';
import type { RequestAuth, RequestScripts } from './request';

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
    /**
     * Política dos scripts (pre-request/post-response). Fica só no banco do app, nunca no
     * `otto.yaml`: uma coleção vinda do Git ou de um .zip não se autoconfia.
     */
    scriptPolicy: ScriptPolicy;
}

/** `scriptMode` ausente = `ask` (pasta vinda de fora). */
export type NewCollectionMetadata = Omit<CollectionMetadata, 'id' | 'scriptPolicy' | keyof Timestamps> & { scriptMode?: ScriptMode };

/**
 * Modo de segurança dos scripts da coleção: `trusted` roda sem perguntar enquanto os
 * scripts forem os mesmos de quando a confiança foi dada; `ask` pergunta uma vez por
 * sessão; `disabled` envia as requisições sem rodar nenhum script.
 */
export const SCRIPT_MODES = ['trusted', 'ask', 'disabled'] as const;
export type ScriptMode = (typeof SCRIPT_MODES)[number];

/** O que os scripts podem fazer, além do isolamento do sandbox. */
export const SCRIPT_PERMISSIONS = ['modifyRequest', 'writeVariables', 'writeCookies', 'sendRequests', 'readSecrets'] as const;
export type ScriptPermission = (typeof SCRIPT_PERMISSIONS)[number];
export type ScriptPermissions = Record<ScriptPermission, boolean>;

/** Padrão de cada modo: fora do `trusted`, os scripts não enviam outras requisições nem leem segredos. */
export const defaultScriptPermissions = (mode: ScriptMode): ScriptPermissions => ({
    modifyRequest: true,
    writeVariables: true,
    writeCookies: true,
    sendRequests: mode === 'trusted',
    readSecrets: mode === 'trusted'
});

export interface ScriptPolicy {
    mode: ScriptMode;
    /** Já resolvidas (as personalizadas ou o padrão do modo). */
    permissions: ScriptPermissions;
    /** Se o usuário personalizou as permissões (senão seguem o padrão do modo). */
    customPermissions: boolean;
    /** Impressão digital dos scripts no momento da confiança (`null` = ainda não calculada). */
    trustedFingerprint: string | null;
    trustedAt: IsoDateTime | null;
}

export type ScriptLocation = 'collection' | 'folder' | 'request';
export type ScriptPhaseName = 'preRequest' | 'postResponse';

/** Um script da coleção (`path`: '' na coleção, a pasta ou o arquivo da requisição). */
export interface CollectionScript {
    location: ScriptLocation;
    path: string;
    phase: ScriptPhaseName;
    code: string;
}

/** Situação do script em relação à versão confiada. */
export type ScriptTrustState = 'same' | 'changed' | 'new';

export interface ScriptInventoryEntry {
    location: ScriptLocation;
    path: string;
    /** Nome legível: "Collection", nome da pasta ou da requisição. */
    name: string;
    phase: ScriptPhaseName;
    /** SHA-256 do código. */
    hash: string;
    size: number;
    lines: number;
    /** Em relação ao snapshot confiado (`same` quando não há confiança). */
    trust: ScriptTrustState;
}

/** Todos os scripts da coleção e a impressão digital atual (comparada com a confiada). */
export interface ScriptInventory {
    fingerprint: string;
    /** Política atual (o main pode ter adotado a impressão digital de uma coleção já confiável). */
    policy: ScriptPolicy;
    entries: ScriptInventoryEntry[];
    /** Confiados que não existem mais. */
    removed: Array<Pick<CollectionScript, 'location' | 'path' | 'phase'> & { name: string }>;
}

/** Alteração da política pela UI (o fingerprint é sempre calculado no main). */
export interface ScriptPolicyPatch {
    mode: ScriptMode;
    /** `null` = voltar ao padrão do modo. */
    permissions: ScriptPermissions | null;
    /** Com `mode: 'trusted'`: confia nos scripts atuais (mesmo que já fosse `trusted`). */
    retrust?: boolean;
}

/** Versão do formato em disco (`otto.yaml`). */
export const COLLECTION_FORMAT_VERSION = 1;

/** Conteúdo do `otto.yaml` na raiz da coleção. */
export interface CollectionManifest {
    version: number;
    name: string;
    description: string;
    /** Headers enviados em todas as requisições da coleção; os da requisição têm prioridade. */
    headers: KeyValue[];
    /** Variáveis da coleção (versionadas): perdem para as do ambiente selecionado. */
    variables: KeyValue[];
    /** Cookies da coleção (isolados por coleção): enviados e atualizados a cada requisição. */
    cookies: CollectionCookie[];
    /** Autenticação usada pelas requisições e pastas com `auth: inherit` (nunca `inherit`). */
    auth: RequestAuth;
    /** Executados antes/depois de cada requisição da coleção (antes dos scripts das pastas e da requisição). */
    scripts: RequestScripts;
    openapi: OpenApiConfig | null;
}

/**
 * Configurações de uma pasta (`_folder.yaml`), herdadas pelo que está dentro dela.
 * `auth: inherit` (padrão) usa a da pasta pai ou a da coleção; as variáveis vencem as
 * da coleção e das pastas acima (o ambiente selecionado vence todas).
 */
export interface FolderSettings {
    auth: RequestAuth;
    variables: KeyValue[];
    scripts: RequestScripts;
}

export const emptyFolderSettings = (): FolderSettings => ({ auth: { type: 'inherit' }, variables: [], scripts: {} });

/** Cookie guardado na coleção. */
export interface CollectionCookie {
    name: string;
    value: string;
    /** Host sem protocolo (`localhost`, `api.exemplo.com`). */
    domain: string;
    path: string;
    /** ISO 8601; `null` = cookie de sessão. */
    expires: string | null;
    secure: boolean;
    httpOnly: boolean;
    /** Só o host exato (sem subdomínios). */
    hostOnly: boolean;
}

/** Alteração editável pela UI no `otto.yaml`. */
export type CollectionManifestPatch = Partial<Pick<CollectionManifest, 'description' | 'headers' | 'variables' | 'cookies' | 'auth' | 'scripts'>>;

/** Nó da árvore de uma coleção lida do disco. */
export type CollectionNode = CollectionFolderNode | CollectionRequestNode;

export interface CollectionFolderNode {
    type: 'folder';
    name: string;
    /** Caminho relativo à raiz da coleção, sempre com `/`. */
    path: string;
    /** Ordem da pasta entre os itens da pasta pai (de `_folder.yaml`); `null` quando não definida. */
    seq: number | null;
    settings: FolderSettings;
    children: CollectionNode[];
}

export interface CollectionRequestNode {
    type: 'request';
    /** `id` estável do arquivo; `null` em arquivos antigos (ainda não regravados) ou inválidos. */
    id: string | null;
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
