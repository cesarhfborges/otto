import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { DEFAULT_WORKSPACE_ID, type EntityId, type LoadedWorkspace, type Workspace, type WorkspaceSummary } from '@shared/models';
import { DialogGateway, WorkspacesGateway } from '../ports';
import { CollectionsState } from './collections.state';
import { ConfirmState } from './confirm.state';
import { EnvironmentsState } from './environments.state';
import { TabsState } from './tabs.state';

/**
 * Workspace ativo e lista de workspaces. Coordena a troca: grava as abas do
 * atual, ativa o novo no main, recarrega coleções, ambientes e abas.
 */
@Injectable({ providedIn: 'root' })
export class WorkspacesState {
    private readonly gateway = inject(WorkspacesGateway);
    private readonly dialogs = inject(DialogGateway);
    private readonly confirm = inject(ConfirmState);
    private readonly collections = inject(CollectionsState);
    private readonly environments = inject(EnvironmentsState);
    private readonly tabs = inject(TabsState);

    private readonly listState = signal<WorkspaceSummary[]>([]);
    private readonly activeState = signal<Workspace | null>(null);
    private readonly collectionsLocationState = signal<string | null>(null);
    private readonly failedState = signal<LoadedWorkspace['failed']>([]);
    private readonly missingState = signal<Workspace | null>(null);
    private readonly busyState = signal(false);

    readonly list = this.listState.asReadonly();
    readonly active = this.activeState.asReadonly();
    readonly activeName = computed(() => this.activeState()?.name ?? 'My Workspace');
    /** Local sugerido para novas coleções (pasta `collections/` do workspace). */
    readonly collectionsLocation = this.collectionsLocationState.asReadonly();
    /** Coleções listadas no workspace que não puderam ser abertas neste computador. */
    readonly failed = this.failedState.asReadonly();
    /** Workspace ativo cuja pasta sumiu (nada foi aberto); emite de novo a cada carga. */
    readonly missingActive = this.missingState.asReadonly();
    readonly busy = this.busyState.asReadonly();

    constructor() {
        inject(DestroyRef).onDestroy(this.gateway.onChanged(() => void this.refreshList()));
    }

    /** Carrega o workspace ativo (ao iniciar e após cada troca). */
    async load(): Promise<void> {
        this.busyState.set(true);

        try {
            const loaded = await this.gateway.load();

            this.activeState.set(loaded.workspace);
            this.collectionsLocationState.set(loaded.collectionsLocation);
            this.failedState.set(loaded.failed);
            this.missingState.set(loaded.missing ? { ...loaded.workspace } : null);
            this.collections.replace(loaded.collections);
            this.environments.reset();
            await this.tabs.restore(loaded.workspace.id, new Set(loaded.collections.map((c) => c.metadata.id)));
        } catch (error) {
            // Fora do Electron (ou falha grave): segue com um workspace vazio.
            console.warn('[otto] could not load the workspace:', error);
            await this.tabs.restore('default', new Set());
        } finally {
            this.busyState.set(false);
        }

        await this.refreshList();
    }

    async switch(id: EntityId): Promise<void> {
        if (id === this.activeState()?.id) {
            return;
        }

        await this.activate(() => this.gateway.switch(id));
    }

    /** Cria na pasta base. Lança o erro para o diálogo exibir. */
    async create(name: string): Promise<void> {
        await this.activate(() => this.gateway.create(name), true);
    }

    /** Extrai na pasta base. Lança o erro para o diálogo exibir. */
    async import(file: string): Promise<void> {
        await this.activate(() => this.gateway.import(file), true);
    }

    /** Pergunta o destino e exporta. Retorna o arquivo gerado, ou `null` se cancelado. */
    async export(workspace: Workspace): Promise<string | null> {
        const file = await this.dialogs.saveWorkspaceArchive(`${workspace.name}.zip`);

        if (file) {
            await this.gateway.export(workspace.id, file);
        }

        return file;
    }

    async rename(id: EntityId, name: string): Promise<void> {
        const renamed = await this.gateway.rename(id, name);

        if (renamed.id === this.activeState()?.id) {
            this.activeState.set(renamed);
        }

        await this.refreshList();
    }

    /** Tira da lista (a pasta continua no disco). Se for o ativo, volta para o padrão. */
    async remove(id: EntityId): Promise<void> {
        const wasActive = id === this.activeState()?.id;

        if (wasActive) {
            await this.tabs.flush();
        }

        await this.gateway.remove(id);

        if (wasActive) {
            await this.load();
        } else {
            await this.refreshList();
        }
    }

    /** Recria a pasta de um workspace que sumiu; se for o ativo, recarrega. */
    async recreate(id: EntityId): Promise<void> {
        await this.gateway.recreate(id);

        if (id === this.activeState()?.id) {
            await this.load();
        } else {
            await this.refreshList();
        }
    }

    /** Troca para o workspace; se a pasta dele sumiu, pergunta antes o que fazer. */
    async open(workspace: WorkspaceSummary): Promise<void> {
        if (!workspace.missing) {
            await this.switch(workspace.id);
        } else if (workspace.id === DEFAULT_WORKSPACE_ID) {
            // O padrão não pode ser removido: recria sem perguntar.
            await this.recreate(workspace.id);
            await this.switch(workspace.id);
        } else {
            await this.resolveMissing(workspace);
        }
    }

    /**
     * Pasta do workspace não encontrada: remover da lista, recriar a pasta (e ativar)
     * ou cancelar. Lança o erro da ação escolhida para quem chamou exibir.
     */
    async resolveMissing(workspace: Workspace): Promise<void> {
        const answer = await this.confirm.choose({
            header: 'Workspace Folder Not Found',
            message: `The folder of "${workspace.name}" no longer exists (${workspace.path}). Remove the workspace from the list, or recreate the folder in the same place with the collections that still exist.`,
            acceptLabel: 'Remove from List',
            severity: 'danger',
            alternativeLabel: 'Recreate Folder'
        });

        if (answer === 'accept') {
            await this.remove(workspace.id);
        } else if (answer === 'alternative') {
            await this.recreate(workspace.id);
            await this.switch(workspace.id);
        }
    }

    reveal(id: EntityId): Promise<void> {
        return this.gateway.reveal(id);
    }

    async refreshList(): Promise<void> {
        try {
            this.listState.set(await this.gateway.list());
        } catch {
            // Fora do Electron não há workspaces.
        }
    }

    private async activate(action: () => Promise<Workspace>, rethrow = false): Promise<void> {
        await this.tabs.flush();

        try {
            await action();
        } catch (error) {
            if (rethrow) {
                throw error;
            }

            console.warn('[otto] could not switch workspace:', error);

            return;
        }

        await this.load();
    }
}
