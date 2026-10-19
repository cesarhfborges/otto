import type { EntityId } from './common';

export const TAB_KINDS = ['request', 'collection', 'environment', 'settings', 'history'] as const;

export type TabKind = (typeof TAB_KINDS)[number];

/** Estado de uma aba aberta, restaurado ao reabrir o app. */
export interface TabState {
    id: EntityId;
    kind: TabKind;
    title: string;
    /** Referência ao recurso aberto (caminho do arquivo da requisição, id da coleção etc.). */
    resourceRef: string | null;
    position: number;
    active: boolean;
    /** Alterações não salvas ou estado de UI da aba, serializados em JSON. */
    draft: string | null;
}
