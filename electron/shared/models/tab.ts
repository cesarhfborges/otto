import type { EntityId } from './common';

/**
 * - `overview` / `environments`: abas do workspace (sem coleção).
 * - `settings`: preferências globais.
 * - `collection`: detalhes da coleção (Etapa 8); `request`: arquivo de requisição.
 */
export const TAB_KINDS = ['overview', 'environments', 'settings', 'collection', 'request', 'environment', 'history', 'workspaces'] as const;

export type TabKind = (typeof TAB_KINDS)[number];

/** Estado de uma aba aberta, restaurado ao reabrir o app. */
export interface TabState {
    id: EntityId;
    kind: TabKind;
    title: string;
    /** Coleção dona da aba (`null` para abas do workspace). */
    collectionId: EntityId | null;
    /** Recurso aberto dentro do contexto (ex.: caminho relativo da requisição). */
    resourceRef: string | null;
    position: number;
    active: boolean;
    /** Alterações não salvas ou estado de UI da aba, serializados em JSON. */
    draft: string | null;
}
