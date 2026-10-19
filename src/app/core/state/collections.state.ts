import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { CollectionMetadata, CollectionNode, EntityId, OpenedCollection } from '@shared/models';
import { ipcErrorMessage } from '../bridge/ipc-error';
import { CollectionsGateway, DialogGateway } from '../ports';

const countRequests = (nodes: CollectionNode[]): number => nodes.reduce((total, node) => total + (node.type === 'request' ? 1 : countRequests(node.children)), 0);

/**
 * Coleções abertas e conhecidas (signals). O conteúdo vem do disco via main;
 * quando arquivos mudam (pelo app, git ou editor externo) a árvore é recarregada.
 */
@Injectable({ providedIn: 'root' })
export class CollectionsState {
    private readonly gateway = inject(CollectionsGateway);
    private readonly dialogs = inject(DialogGateway);
    private readonly openedState = signal<OpenedCollection[]>([]);
    private readonly knownState = signal<CollectionMetadata[]>([]);
    private readonly errorState = signal<string | null>(null);

    readonly opened = this.openedState.asReadonly();
    /** Todas as coleções registradas no banco (abertas ou não). */
    readonly known = this.knownState.asReadonly();
    /** Última falha (abrir pasta inválida, criar em pasta ocupada...), para a UI exibir. */
    readonly error = this.errorState.asReadonly();
    readonly openedIds = computed(() => new Set(this.openedState().map((c) => c.metadata.id)));

    constructor() {
        inject(DestroyRef).onDestroy(this.gateway.onChanged(({ collectionId }) => void this.refresh(collectionId)));
    }

    find(id: EntityId | null): OpenedCollection | null {
        return id ? (this.openedState().find((c) => c.metadata.id === id) ?? null) : null;
    }

    requestCount(id: EntityId): number {
        const collection = this.find(id);

        return collection ? countRequests(collection.tree.children) : 0;
    }

    /** Reabre as coleções que estavam abertas quando o app foi fechado. */
    async restore(): Promise<void> {
        await this.loadKnown();

        for (const collection of this.knownState().filter((c) => c.open)) {
            try {
                this.track(await this.gateway.open(collection.path));
            } catch (error) {
                // Pasta removida/renomeada fora do app: fecha para não insistir a cada início.
                console.warn(`[otto] could not reopen "${collection.path}":`, error);
                await this.gateway.close(collection.id).catch(() => undefined);
            }
        }

        await this.loadKnown();
    }

    async loadKnown(): Promise<void> {
        try {
            this.knownState.set(await this.gateway.list());
        } catch {
            // Fora do Electron não há coleções.
        }
    }

    /** Abre a pasta indicada (ex.: vinda do menu ou da lista) ou pergunta ao usuário. */
    async open(directory?: string): Promise<OpenedCollection | null> {
        return this.run(async () => {
            const target = directory ?? (await this.dialogs.openCollection());

            return target ? this.track(await this.gateway.open(target)) : null;
        });
    }

    /** Cria `<parentDirectory>/<slug do nome>` com o manifesto e abre a coleção. */
    async create(parentDirectory: string, name: string): Promise<OpenedCollection | null> {
        return this.run(async () => this.track(await this.gateway.createOnDisk(parentDirectory, name)));
    }

    async close(id: EntityId): Promise<void> {
        await this.gateway.close(id);
        this.openedState.update((list) => list.filter((c) => c.metadata.id !== id));
        await this.loadKnown();
    }

    /** Remove a coleção do workspace (não apaga nada do disco). */
    async forget(id: EntityId): Promise<void> {
        await this.gateway.delete(id);
        this.openedState.update((list) => list.filter((c) => c.metadata.id !== id));
        await this.loadKnown();
    }

    async refresh(id: EntityId): Promise<void> {
        if (!this.find(id)) {
            return;
        }

        try {
            const tree = await this.gateway.tree(id);

            this.openedState.update((list) => list.map((c) => (c.metadata.id === id ? { ...c, tree } : c)));
        } catch (error) {
            // A pasta pode ter sido removida/renomeada fora do app.
            this.errorState.set(ipcErrorMessage(error));
        }
    }

    clearError(): void {
        this.errorState.set(null);
    }

    private track(collection: OpenedCollection): OpenedCollection {
        this.openedState.update((list) => {
            const index = list.findIndex((c) => c.metadata.id === collection.metadata.id);

            return index >= 0 ? list.map((c, i) => (i === index ? collection : c)) : [...list, collection];
        });
        void this.loadKnown();

        return collection;
    }

    private async run<T>(action: () => Promise<T>): Promise<T | null> {
        this.errorState.set(null);

        try {
            return await action();
        } catch (error) {
            this.errorState.set(ipcErrorMessage(error));

            return null;
        }
    }
}
