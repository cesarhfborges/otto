import { Component, inject, signal, viewChild } from '@angular/core';
import type { CollectionMetadata } from '@shared/models';
import type { MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { MenuModule, type Menu } from 'primeng/menu';
import { TooltipModule } from 'primeng/tooltip';
import { CollectionsState } from '../../core/state/collections.state';
import { EnvironmentsState } from '../../core/state/environments.state';
import { TabsState } from '../../core/state/tabs.state';
import { UiState } from '../../core/state/ui.state';

/** Visão geral do workspace: números, ações rápidas e coleções conhecidas. */
@Component({
    selector: 'app-workspace-overview',
    imports: [ButtonModule, MenuModule, TooltipModule],
    template: `
        <div class="flex max-w-5xl flex-col gap-6 p-4">
            <dl class="m-0 flex gap-8" aria-label="Workspace summary">
                <div class="flex flex-col-reverse">
                    <dt class="text-xs text-muted-color">Collections</dt>
                    <dd class="m-0 text-2xl font-semibold">{{ collections.known().length }}</dd>
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
                    <p-button label="Open Collection" icon="pi pi-folder-open" size="small" severity="secondary" [outlined]="true" (onClick)="collections.open()" />
                    <span pTooltip="OpenAPI import is not available yet" tooltipPosition="bottom">
                        <p-button label="Import Collection" icon="pi pi-download" size="small" severity="secondary" [outlined]="true" [disabled]="true" />
                    </span>
                </div>
            </section>

            <section aria-labelledby="collections-list-heading" class="flex flex-col gap-2">
                <h2 id="collections-list-heading" class="m-0 text-sm font-medium text-muted-color">Collections</h2>
                @if (collections.known().length) {
                    <ul class="m-0 flex list-none flex-col p-0">
                        @for (collection of collections.known(); track collection.id) {
                            <li class="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-100 dark:hover:bg-surface-800">
                                <i class="pi pi-box text-muted-color" aria-hidden="true"></i>
                                <button type="button" class="flex min-w-0 flex-1 cursor-pointer flex-col items-start border-0 bg-transparent p-0 text-left text-color" (click)="openCollection(collection)">
                                    <span class="flex items-center gap-2 text-sm font-medium">
                                        {{ collection.name }}
                                        @if (collection.open) {
                                            <span class="rounded bg-primary-50 px-1.5 text-xs text-primary-700 dark:bg-primary-950 dark:text-primary-300">open</span>
                                        }
                                    </span>
                                    <span class="max-w-full truncate text-xs text-muted-color">{{ collection.path }}</span>
                                </button>
                                <button type="button" class="otto-icon-button" [attr.aria-label]="'Actions for ' + collection.name" aria-haspopup="menu" (click)="showMenu($event, collection)">
                                    <i class="pi pi-ellipsis-h" aria-hidden="true"></i>
                                </button>
                            </li>
                        }
                    </ul>
                } @else {
                    <p class="m-0 text-sm text-muted-color">No collections yet. Create a new one or open a folder that contains an <code>otto.yaml</code>.</p>
                }
            </section>
        </div>
        <p-menu #rowMenu [model]="rowItems()" [popup]="true" appendTo="body" />
    `,
    host: { class: 'block' }
})
export class WorkspaceOverview {
    protected readonly collections = inject(CollectionsState);
    protected readonly environments = inject(EnvironmentsState);
    protected readonly ui = inject(UiState);
    private readonly tabs = inject(TabsState);

    private readonly rowMenu = viewChild.required<Menu>('rowMenu');

    protected readonly rowItems = signal<MenuItem[]>([]);

    constructor() {
        void this.collections.loadKnown();
        void this.environments.load(null);
    }

    protected async openCollection(collection: CollectionMetadata): Promise<void> {
        const opened = this.collections.find(collection.id) ?? (await this.collections.open(collection.path));

        if (opened) {
            this.tabs.open({ kind: 'collection', title: 'Overview', collectionId: opened.metadata.id });
        }
    }

    protected showMenu(event: MouseEvent, collection: CollectionMetadata): void {
        this.rowItems.set([
            { label: 'Open', icon: 'pi pi-folder-open', command: () => void this.openCollection(collection) },
            {
                label: 'Close',
                icon: 'pi pi-times',
                disabled: !collection.open,
                command: () => {
                    this.tabs.closeCollection(collection.id);
                    void this.collections.close(collection.id);
                }
            },
            { separator: true },
            {
                label: 'Remove from Workspace',
                icon: 'pi pi-minus-circle',
                command: () => {
                    this.tabs.closeCollection(collection.id);
                    void this.collections.forget(collection.id);
                }
            }
        ]);
        // O conteúdo do popup é renderizado depois, já com o modelo atualizado.
        this.rowMenu().toggle(event);
    }
}
