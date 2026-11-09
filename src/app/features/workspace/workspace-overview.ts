import { Component, computed, inject, signal, viewChild } from '@angular/core';
import type { CollectionExportFormat, CollectionMetadata, EntityId } from '@shared/models';
import { MessageService, type MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { TieredMenuModule, type TieredMenu } from 'primeng/tieredmenu';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { CollectionFilesGateway } from '../../core/ports';
import { CollectionsState } from '../../core/state/collections.state';
import { EnvironmentsState } from '../../core/state/environments.state';
import { TabsState } from '../../core/state/tabs.state';
import { UiState } from '../../core/state/ui.state';
import { WorkspacesState } from '../../core/state/workspaces.state';
import { CollectionAvatar } from '../../shared/collection-avatar';
import { copyName } from '../../shared/copy-name';
import { NameDialog, type NameRequest } from '../../shared/name-dialog';

/** Visão geral do workspace ativo: local, números, ações rápidas e as coleções em cards (escolher um abre a coleção). */
@Component({
    selector: 'app-workspace-overview',
    imports: [ButtonModule, TieredMenuModule, NameDialog, CollectionAvatar],
    template: `
        <!-- Topo fixo (local, números, ações); só a grade de coleções rola. Com pouca altura, compacta (ver styles). -->
        <div class="overview-top flex max-w-5xl shrink-0 flex-col gap-6 p-4 pb-0">
            <p class="overview-path m-0 flex min-w-0 items-center gap-2 text-sm text-muted-color">
                <i class="pi pi-folder" aria-hidden="true"></i>
                @if (workspaces.active()?.path; as folder) {
                    <span class="truncate" [title]="folder">{{ folder }}</span>
                } @else {
                    <span>Local workspace (stored only on this computer)</span>
                }
            </p>
            <dl class="overview-summary m-0 flex gap-8" aria-label="Workspace summary">
                <div class="overview-stat flex flex-col-reverse">
                    <dt class="text-xs text-muted-color">Collections</dt>
                    <dd class="m-0 text-2xl font-semibold tabular-nums">{{ collections.opened().length }}</dd>
                </div>
                <div class="overview-stat flex flex-col-reverse">
                    <dt class="text-xs text-muted-color">Environments</dt>
                    <dd class="m-0 text-2xl font-semibold tabular-nums">{{ environments.list(null).length }}</dd>
                </div>
            </dl>

            <section aria-labelledby="quick-actions-heading" class="flex flex-col gap-2">
                <h2 id="quick-actions-heading" class="overview-actions-heading otto-section-label">Quick Actions</h2>
                <div class="flex flex-wrap gap-2">
                    <p-button label="Create Collection" icon="pi pi-plus" size="small" severity="secondary" [outlined]="true" (onClick)="ui.newCollectionDialog.set(true)" />
                    <p-button label="Import Collection" icon="pi pi-download" size="small" severity="secondary" [outlined]="true" (onClick)="ui.importCollectionDialog.set(true)" />
                    <p-button label="Environments" icon="pi pi-globe" size="small" severity="secondary" [outlined]="true" (onClick)="openEnvironments()" />
                </div>
            </section>
        </div>

        <!--
            A área de rolagem ocupa a largura toda (a barra fica na borda do painel, não no meio da tela);
            a grade dentro dela mantém o max-w do topo. Com a janela muito baixa, o min-h garante uma
            área útil e o painel da aba passa a rolar tudo. O pt-1 evita cortar o anel de foco da 1ª linha.
        -->
        <section aria-labelledby="collections-list-heading" class="overview-collections mt-6 flex min-h-48 flex-1 flex-col">
            <h2 id="collections-list-heading" class="otto-section-label shrink-0 border-b px-4 pb-2 transition-colors" [class]="scrolled() ? 'border-surface-200 dark:border-surface-700' : 'border-transparent'">Collections</h2>
            @if (cards().length) {
                <div class="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-4" (scroll)="onListScroll($event)">
                    <ul class="m-0 grid max-w-5xl list-none grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3 p-0 pt-1">
                        @for (card of cards(); track card.id) {
                            <li class="relative">
                                <button
                                    type="button"
                                    class="otto-collection-card flex h-full w-full cursor-pointer flex-col gap-3 rounded-lg border border-surface-200 bg-surface-0 p-4 pr-12 text-left text-color transition-colors hover:border-primary hover:bg-surface-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-surface-700 dark:bg-surface-900 dark:hover:bg-surface-800"
                                    [attr.aria-describedby]="'collection-card-meta-' + card.id"
                                    (click)="openCollection(card.id)"
                                >
                                    <span class="flex min-w-0 items-center gap-3">
                                        <app-collection-avatar [name]="card.name" />
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
                    </ul>
                </div>
            } @else {
                <!-- Estado vazio: as ações de criar/importar já estão em Quick Actions, acima (sem botões repetidos). -->
                <div class="mx-4 mt-2 flex max-w-5xl flex-col items-center gap-3 rounded-lg border border-dashed border-surface-300 px-6 py-10 text-center dark:border-surface-600">
                    <span class="otto-empty-icon" aria-hidden="true"><i class="pi pi-box"></i></span>
                    <p class="m-0 text-base font-semibold">No collections yet</p>
                    <p class="m-0 max-w-md text-sm text-muted-color">Create or import one with the quick actions above, or open a folder that contains an <code>otto.yaml</code>.</p>
                </div>
            }
        </section>
        <p-tiered-menu #rowMenu [model]="rowItems()" [popup]="true" appendTo="body" />
        <app-name-dialog [(request)]="nameDialog" />
    `,
    /*
     * O host é um container de tamanho: com pouca altura (janela baixa), o topo deixa de empilhar
     * caminho, números e ações em blocos e vira duas linhas (caminho; números em linha + botões),
     * devolvendo à grade de coleções a maior parte do espaço. Com altura de sobra, o layout amplo.
     */
    styles: `
        :host {
            container: workspace-overview / size;
        }

        @container workspace-overview (max-height: 600px) {
            .overview-top {
                flex-direction: row;
                flex-wrap: wrap;
                align-items: center;
                column-gap: 1.5rem;
                row-gap: 0.5rem;
                padding-top: 0.75rem;
            }

            .overview-path {
                flex-basis: 100%;
            }

            .overview-summary {
                gap: 1rem;
            }

            .overview-stat {
                flex-direction: row-reverse;
                justify-content: flex-end;
                align-items: baseline;
                gap: 0.375rem;
            }

            .overview-stat dd {
                font-size: 1rem;
            }

            .overview-stat dt {
                font-size: 0.875rem;
            }

            /* Título só para leitores de tela: os botões falam por si. */
            .overview-actions-heading {
                position: absolute;
                width: 1px;
                height: 1px;
                overflow: hidden;
                clip-path: inset(50%);
                white-space: nowrap;
            }

            .overview-collections {
                margin-top: 1rem;
            }
        }
    `,
    host: { class: 'flex h-full min-h-0 flex-col' }
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
    /** Diálogo do nome da cópia (duplicar coleção). */
    protected readonly nameDialog = signal<NameRequest | null>(null);
    /** Lista rolada: o título "Collections" ganha uma linha de separação do conteúdo que passa por baixo. */
    protected readonly scrolled = signal(false);

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

    protected onListScroll(event: Event): void {
        this.scrolled.set((event.target as HTMLElement).scrollTop > 0);
    }

    protected openEnvironments(): void {
        this.tabs.open({ kind: 'environments', title: 'Environments', collectionId: null });
    }

    protected showMenu(event: MouseEvent, collection: CollectionMetadata): void {
        this.rowItems.set([
            { label: 'Open', icon: 'pi pi-arrow-right', command: () => this.openCollection(collection.id) },
            { label: 'Duplicate', icon: 'pi pi-copy', command: () => this.askDuplicate(collection) },
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

    /** Pede o nome da cópia, sugerindo "<nome> Copy" único entre as coleções conhecidas pelo app. */
    private askDuplicate(collection: CollectionMetadata): void {
        this.nameDialog.set({
            header: 'Duplicate Collection',
            acceptLabel: 'Duplicate',
            acceptIcon: 'pi pi-copy',
            name: copyName(
                collection.name,
                [...this.collections.known(), ...this.collections.opened().map((c) => c.metadata)].map((c) => c.name)
            ),
            folder: true,
            submit: async (name) => {
                const copy = await this.collections.duplicate(collection.id, name);

                this.messages.add({ severity: 'success', summary: 'Collection duplicated', detail: copy.metadata.name, life: 4000 });
            }
        });
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
