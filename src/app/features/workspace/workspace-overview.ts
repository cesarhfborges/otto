import { Component, computed, inject, signal, viewChild } from '@angular/core';
import type { CollectionExportFormat, CollectionMetadata, EntityId } from '@shared/models';
import { MessageService, type MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { MenuModule } from 'primeng/menu';
import { TieredMenuModule, type TieredMenu } from 'primeng/tieredmenu';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { CollectionFilesGateway } from '../../core/ports';
import { CollectionsState } from '../../core/state/collections.state';
import { EnvironmentsState } from '../../core/state/environments.state';
import { TabsState } from '../../core/state/tabs.state';
import { UiState } from '../../core/state/ui.state';
import { WorkspacesState } from '../../core/state/workspaces.state';

/** Visão geral do workspace ativo: local, números, ações rápidas e as coleções em cards (escolher um abre a coleção). */
@Component({
    selector: 'app-workspace-overview',
    imports: [ButtonModule, MenuModule, TieredMenuModule],
    template: `
        <div class="flex max-w-5xl flex-col gap-6 p-4">
            <p class="m-0 flex items-center gap-2 text-sm text-muted-color">
                <i class="pi pi-folder" aria-hidden="true"></i>
                @if (workspaces.active()?.path; as folder) {
                    <span class="truncate" [title]="folder">{{ folder }}</span>
                } @else {
                    <span>Local workspace (stored only on this computer)</span>
                }
            </p>
            <dl class="m-0 flex gap-8" aria-label="Workspace summary">
                <div class="flex flex-col-reverse">
                    <dt class="text-xs text-muted-color">Collections</dt>
                    <dd class="m-0 text-2xl font-semibold">{{ collections.opened().length }}</dd>
                </div>
                <div class="flex flex-col-reverse">
                    <dt class="text-xs text-muted-color">Environments</dt>
                    <dd class="m-0 text-2xl font-semibold">{{ environments.list(null).length }}</dd>
                </div>
            </dl>

            <section aria-labelledby="quick-actions-heading" class="flex flex-col gap-2">
                <h2 id="quick-actions-heading" class="m-0 text-sm font-medium text-muted-color">Quick Actions</h2>
                <div class="flex flex-wrap gap-2">
                    <p-button label="Create Collection" icon="pi pi-plus" size="small" severity="secondary" [outlined]="true" (onClick)="ui.newCollectionDialog.set(true)" />
                    <p-button label="Import Collection" icon="pi pi-download" size="small" severity="secondary" [outlined]="true" (onClick)="ui.importCollectionDialog.set(true)" />
                    <p-button label="Environments" icon="pi pi-globe" size="small" severity="secondary" [outlined]="true" (onClick)="openEnvironments()" />
                </div>
            </section>

            <section aria-labelledby="collections-list-heading" class="flex flex-col gap-3">
                <h2 id="collections-list-heading" class="m-0 text-sm font-medium text-muted-color">Collections</h2>
                @if (cards().length) {
                    <ul class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3 p-0">
                        @for (card of cards(); track card.id) {
                            <li class="relative">
                                <button
                                    type="button"
                                    class="otto-collection-card flex h-full w-full cursor-pointer flex-col gap-3 rounded-lg border border-surface-200 bg-surface-0 p-4 pr-12 text-left text-color transition-colors hover:border-primary hover:bg-surface-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-surface-700 dark:bg-surface-900 dark:hover:bg-surface-800"
                                    [attr.aria-describedby]="'collection-card-meta-' + card.id"
                                    (click)="openCollection(card.id)"
                                >
                                    <span class="flex min-w-0 items-center gap-3">
                                        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-200" aria-hidden="true">
                                            <i class="pi pi-box text-lg"></i>
                                        </span>
                                        <span class="flex min-w-0 flex-col">
                                            <span class="truncate text-base font-semibold">{{ card.name }}</span>
                                            <span class="truncate text-xs text-muted-color" [title]="card.path">{{ card.path }}</span>
                                        </span>
                                    </span>
                                    <span [id]="'collection-card-meta-' + card.id" class="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-color">
                                        <span class="inline-flex items-center gap-1"><i class="pi pi-send text-xs" aria-hidden="true"></i>{{ card.requests }} {{ card.requests === 1 ? 'request' : 'requests' }}</span>
                                        @if (card.openTabs) {
                                            <span class="inline-flex items-center gap-1"><i class="pi pi-clone text-xs" aria-hidden="true"></i>{{ card.openTabs }} open {{ card.openTabs === 1 ? 'tab' : 'tabs' }}</span>
                                        }
                                        @if (card.openapi) {
                                            <span class="rounded-full bg-surface-100 px-2 py-0.5 font-medium text-color dark:bg-surface-800">OpenAPI</span>
                                        }
                                    </span>
                                </button>
                                <button type="button" class="otto-icon-button absolute right-2 top-2" [attr.aria-label]="'Actions for ' + card.name" aria-haspopup="menu" (click)="showMenu($event, card.metadata)">
                                    <i class="pi pi-ellipsis-v" aria-hidden="true"></i>
                                </button>
                            </li>
                        }
                        <li>
                            <button
                                type="button"
                                class="flex h-full min-h-28 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-surface-300 bg-transparent p-4 text-sm text-muted-color transition-colors hover:border-primary hover:text-color focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-surface-600"
                                aria-haspopup="menu"
                                (click)="addMenu.toggle($event)"
                            >
                                <i class="pi pi-plus text-lg" aria-hidden="true"></i>
                                <span>New or import collection</span>
                            </button>
                        </li>
                    </ul>
                } @else {
                    <p class="m-0 text-sm text-muted-color">This workspace has no collections yet. Create a new one or open a folder that contains an <code>otto.yaml</code>.</p>
                }
            </section>
        </div>
        <p-tiered-menu #rowMenu [model]="rowItems()" [popup]="true" appendTo="body" />
        <p-menu #addMenu [model]="addItems" [popup]="true" appendTo="body" />
    `,
    host: { class: 'block' }
})
export class WorkspaceOverview {
    protected readonly collections = inject(CollectionsState);
    protected readonly environments = inject(EnvironmentsState);
    protected readonly ui = inject(UiState);
    protected readonly workspaces = inject(WorkspacesState);
    private readonly tabs = inject(TabsState);

    private readonly files = inject(CollectionFilesGateway);
    private readonly messages = inject(MessageService);
    private readonly rowMenu = viewChild.required<TieredMenu>('rowMenu');

    protected readonly rowItems = signal<MenuItem[]>([]);
    protected readonly addItems: MenuItem[] = [
        { label: 'New Collection', icon: 'pi pi-plus', command: () => this.ui.newCollectionDialog.set(true) },
        { label: 'Import Collection', icon: 'pi pi-download', command: () => this.ui.importCollectionDialog.set(true) }
    ];

    protected readonly cards = computed(() => {
        const tabs = this.tabs.tabs();

        return this.collections.opened().map(({ metadata, manifest }) => ({
            id: metadata.id,
            metadata,
            name: metadata.name,
            path: metadata.path,
            requests: this.collections.requestCount(metadata.id),
            openTabs: tabs.filter((tab) => tab.collectionId === metadata.id).length,
            openapi: !!manifest.openapi
        }));
    });

    constructor() {
        void this.environments.load(null);
    }

    protected openCollection(collectionId: EntityId): void {
        this.tabs.enterCollection(collectionId);
    }

    protected openEnvironments(): void {
        this.tabs.open({ kind: 'environments', title: 'Environments', collectionId: null });
    }

    protected showMenu(event: MouseEvent, collection: CollectionMetadata): void {
        this.rowItems.set([
            { label: 'Open', icon: 'pi pi-arrow-right', command: () => this.openCollection(collection.id) },
            { label: 'Reveal in File Explorer', icon: 'pi pi-folder-open', command: () => void this.reveal(collection.id) },
            {
                label: 'Export Collection',
                icon: 'pi pi-upload',
                items: [
                    { label: 'Otto Backup (ZIP)', icon: 'pi pi-box', command: () => void this.exportCollection(collection, 'backup') },
                    { label: 'OpenAPI Spec', icon: 'pi pi-file', command: () => void this.exportCollection(collection, 'openapi') }
                ]
            },
            { separator: true },
            { label: 'Remove from Workspace', icon: 'pi pi-minus-circle', command: () => this.ui.removeCollectionDialog.set(collection.id) }
        ]);
        // O conteúdo do popup é renderizado depois, já com o modelo atualizado.
        this.rowMenu().toggle(event);
    }

    private async exportCollection(collection: CollectionMetadata, format: CollectionExportFormat): Promise<void> {
        try {
            const file = await this.collections.export(collection, format);

            if (file) {
                this.messages.add({ severity: 'success', summary: 'Collection exported', detail: file, life: 5000 });
            }
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not export the collection', detail: ipcErrorMessage(error), life: 6000 });
        }
    }

    private async reveal(collectionId: EntityId): Promise<void> {
        try {
            await this.files.reveal(collectionId, '');
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not reveal in file explorer', detail: ipcErrorMessage(error), life: 6000 });
        }
    }
}
