import { effect, Injectable, signal } from '@angular/core';
import type { EntityId } from '@shared/models';

const SIDEBAR_KEY = 'otto.sidebarVisible';

/** Destino de uma nova requisição: coleção e pasta (relativa à raiz). */
export interface NewRequestTarget {
    collectionId: EntityId;
    folder: string;
}

/** `localStorage` pode estar indisponível; a preferência é só uma conveniência visual. */
function readFlag(key: string, fallback: boolean): boolean {
    try {
        const value = localStorage.getItem(key);

        return value === null ? fallback : value === '1';
    } catch {
        return fallback;
    }
}

/** Estado visual do shell: barra lateral e diálogos globais. */
@Injectable({ providedIn: 'root' })
export class UiState {
    readonly sidebarVisible = signal(readFlag(SIDEBAR_KEY, true));
    readonly newCollectionDialog = signal(false);
    readonly newRequestDialog = signal<NewRequestTarget | null>(null);
    readonly newFolderDialog = signal<NewRequestTarget | null>(null);
    readonly newWorkspaceDialog = signal(false);
    readonly importWorkspaceDialog = signal(false);
    readonly importCollectionDialog = signal(false);
    /** Pedido para abrir a página da coleção numa aba específica (ex.: botão de sync → OpenAPI). */
    readonly collectionSection = signal<{ collectionId: EntityId; section: 'overview' | 'headers' | 'openapi' } | null>(null);

    constructor() {
        effect(() => {
            const visible = this.sidebarVisible();

            try {
                localStorage.setItem(SIDEBAR_KEY, visible ? '1' : '0');
            } catch {
                // Sem armazenamento: a preferência vale só nesta sessão.
            }
        });
    }

    toggleSidebar(): void {
        this.sidebarVisible.update((visible) => !visible);
    }
}
