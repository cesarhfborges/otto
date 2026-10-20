import type { OpenedCollection } from './collection';
import type { EntityId, IsoDateTime, Timestamps } from './common';

/** Workspace local criado pelo app na primeira execução; não tem pasta e não pode ser removido. */
export const DEFAULT_WORKSPACE_ID = 'default';

/** Versão do formato em disco (`workspace.yaml`). */
export const WORKSPACE_FORMAT_VERSION = 1;

export const WORKSPACE_MANIFEST_FILE = 'workspace.yaml';

/**
 * Workspace: conjunto de coleções. Com `path`, é uma pasta no disco com
 * `workspace.yaml` (versionável e compartilhável); sem `path`, vive só no banco local.
 */
export interface Workspace extends Timestamps {
    id: EntityId;
    name: string;
    /** Pasta do workspace; `null` no workspace local padrão. */
    path: string | null;
    lastOpenedAt: IsoDateTime | null;
}

export interface WorkspaceSummary extends Workspace {
    active: boolean;
    collectionCount: number;
    /** A pasta (ou o `workspace.yaml`) não existe mais. */
    missing: boolean;
}

/** Conteúdo do `workspace.yaml`. Caminhos relativos à pasta do workspace (com `/`) ou absolutos. */
export interface WorkspaceManifest {
    version: number;
    name: string;
    collections: Array<{ path: string }>;
}

/** Coleções do workspace ativo carregadas do disco; as que falharam (pasta ausente, manifesto inválido) vêm à parte. */
export interface LoadedWorkspace {
    workspace: Workspace;
    collections: OpenedCollection[];
    failed: Array<{ path: string; error: string }>;
    /** A pasta (ou o `workspace.yaml`) não existe mais: nenhuma coleção é aberta e o usuário escolhe remover ou recriar. */
    missing: boolean;
    /** Local sugerido para novas coleções (`<workspace>/collections`); `null` no workspace padrão. */
    collectionsLocation: string | null;
}
