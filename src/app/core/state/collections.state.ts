import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { CollectionExportFormat, CollectionFolderNode, CollectionImportRequest, CollectionManifestPatch, CollectionMetadata, CollectionNode, EntityId, FolderSettings, OpenedCollection } from '@shared/models';
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

    /** Substitui as coleções abertas pelas do workspace carregado. */
    replace(collections: OpenedCollection[]): void {
        this.openedState.set(collections);
        void this.loadKnown();
    }

    async loadKnown(): Promise<void> {
        try {
            this.knownState.set(await this.gateway.list());
        } catch {
            // Fora do Electron não há coleções.
        }
    }

    /** Cria `<workspace>/collections/<slug do nome>`. Lança o erro para o diálogo exibir. */
    async create(name: string): Promise<OpenedCollection> {
        return this.track(await this.gateway.createOnDisk(name));
    }

    /** Importa um backup do Otto ou um spec OpenAPI para o workspace ativo. Lança o erro para o diálogo exibir. */
    async import(request: CollectionImportRequest): Promise<OpenedCollection> {
        return this.track(await this.gateway.import(request));
    }

    /** Pergunta o destino e exporta como backup (.zip) ou spec OpenAPI. Retorna o arquivo, ou `null` se cancelado. */
    async export(collection: CollectionMetadata, format: CollectionExportFormat): Promise<string | null> {
        const file = format === 'backup' ? await this.dialogs.saveCollectionArchive(`${collection.name}.zip`) : await this.dialogs.saveOpenApiSpec(`${collection.name}.openapi.yaml`);

        if (file) {
            await this.gateway.export(collection.id, format, file);
        }

        return file;
    }

    async close(id: EntityId): Promise<void> {
        await this.gateway.close(id);
        this.openedState.update((list) => list.filter((c) => c.metadata.id !== id));
        await this.loadKnown();
    }

    /** Tira do workspace e envia a pasta da coleção para a lixeira. Lança o erro para o diálogo exibir. */
    async trash(id: EntityId): Promise<void> {
        await this.gateway.trash(id);
        this.openedState.update((list) => list.filter((c) => c.metadata.id !== id));
        await this.loadKnown();
    }

    /** Esquece a coleção no app (não apaga nada do disco). */
    async forget(id: EntityId): Promise<void> {
        await this.gateway.delete(id);
        this.openedState.update((list) => list.filter((c) => c.metadata.id !== id));
        await this.loadKnown();
    }

    /** Grava descrição/headers no `otto.yaml`. Lança o erro para a tela exibir. */
    async updateManifest(id: EntityId, patch: CollectionManifestPatch): Promise<void> {
        const manifest = await this.gateway.updateManifest(id, patch);

        this.openedState.update((list) => list.map((c) => (c.metadata.id === id ? { ...c, manifest } : c)));
    }

    /** Grava autenticação/variáveis/scripts da pasta e atualiza a árvore em memória. Lança o erro para a tela exibir. */
    async updateFolder(id: EntityId, folder: string, patch: Partial<FolderSettings>): Promise<void> {
        const settings = await this.gateway.updateFolder(id, folder, patch);
        const apply = (nodes: CollectionNode[]): CollectionNode[] => nodes.map((node) => (node.type !== 'folder' ? node : node.path === folder ? { ...node, settings } : { ...node, children: apply(node.children) }));

        this.openedState.update((list) => list.map((c) => (c.metadata.id === id ? { ...c, tree: { ...c.tree, children: apply(c.tree.children) } } : c)));
    }

    /** Pasta da coleção pelo caminho relativo (`a/b`). */
    findFolder(id: EntityId | null, folder: string): CollectionFolderNode | null {
        let nodes = this.find(id)?.tree.children ?? [];
        let found: CollectionFolderNode | null = null;
        let current = '';

        for (const segment of folder.split('/').filter(Boolean)) {
            current = current ? `${current}/${segment}` : segment;
            found = nodes.find((node): node is CollectionFolderNode => node.type === 'folder' && node.path === current) ?? null;

            if (!found) {
                return null;
            }

            nodes = found.children;
        }

        return found;
    }

    /** Relê árvore e manifesto (mudanças pelo app, Git ou editor externo). */
    async refresh(id: EntityId): Promise<void> {
        if (!this.find(id)) {
            return;
        }

        try {
            const [tree, manifest] = await Promise.all([this.gateway.tree(id), this.gateway.manifest(id)]);

            this.openedState.update((list) => list.map((c) => (c.metadata.id === id ? { ...c, tree, manifest } : c)));
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
