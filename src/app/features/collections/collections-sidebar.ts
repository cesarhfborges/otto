import { Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { MessageService, PrimeTemplate, type MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ContextMenu, ContextMenuModule } from 'primeng/contextmenu';
import { MenuModule } from 'primeng/menu';
import { TooltipModule } from 'primeng/tooltip';
import { TreeModule } from 'primeng/tree';
import type { TreeNodeCollapseEvent, TreeNodeContextMenuSelectEvent, TreeNodeExpandEvent, TreeNodeSelectEvent } from 'primeng/types/tree';
import type { CollectionExportFormat } from '@shared/models';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { CollectionFilesGateway } from '../../core/ports';
import { CollectionsState } from '../../core/state/collections.state';
import { ConfirmState } from '../../core/state/confirm.state';
import { TabsState } from '../../core/state/tabs.state';
import { UiState } from '../../core/state/ui.state';
import { MethodBadge } from '../../shared/method-badge';
import { TreeToggleLabel } from '../../shared/tree-toggle-label.directive';
import { buildSidebarNodes, findNode, folderOf, nodeKey, type SidebarNode, type SidebarNodeData } from './collection-tree-nodes';

/** Barra lateral: coleções abertas em árvore (pastas e requisições), com ações por contexto. */
@Component({
    selector: 'app-collections-sidebar',
    imports: [TreeModule, PrimeTemplate, ContextMenuModule, MenuModule, ButtonModule, TooltipModule, MethodBadge, TreeToggleLabel],
    template: `
        <div class="flex items-center gap-2 h-9 px-2 border-b border-surface-200 dark:border-surface-800">
            <div class="flex-1 flex items-center gap-2">
                <i class="pi pi-box text-sm text-muted-color" aria-hidden="true"></i>
                <h2 id="collections-heading" class="m-0 flex-1 text-sm font-semibold">Collections</h2>
            </div>
            <div class="flex flex-row justify-end gap-2">
                <button type="button" class="otto-icon-button" [attr.aria-pressed]="filterVisible()" aria-label="Search collections" pTooltip="Search" tooltipPosition="bottom" (click)="filterVisible.set(!filterVisible())">
                    <i class="pi pi-search text-sm" aria-hidden="true"></i>
                </button>
                <button type="button" class="otto-icon-button" aria-label="Add collection" aria-haspopup="menu" pTooltip="Add collection" tooltipPosition="bottom" (click)="addMenu.toggle($event)">
                    <i class="pi pi-plus text-sm" aria-hidden="true"></i>
                </button>
                <button type="button" class="otto-icon-button" aria-label="More collection actions" aria-haspopup="menu" (click)="moreMenu.toggle($event)">
                    <i class="pi pi-ellipsis-v text-sm" aria-hidden="true"></i>
                </button>
            </div>
        </div>

        @if (nodes().length) {
            <p-tree
                class="min-h-0 flex-1 overflow-auto"
                styleClass="!bg-transparent !p-1"
                [value]="nodes()"
                selectionMode="single"
                [selection]="selectedNode()"
                [filter]="filterVisible()"
                filterMode="lenient"
                filterPlaceholder="Filter requests"
                ariaLabelledBy="collections-heading"
                appTreeToggleLabel
                [contextMenu]="contextMenu"
                (onNodeSelect)="onSelect($event)"
                (onNodeExpand)="setExpanded($event, true)"
                (onNodeCollapse)="setExpanded($event, false)"
                (onNodeContextMenuSelect)="onContextMenu($event)"
            >
                <ng-template pTemplate="otto" let-node>
                    <span class="group flex min-w-0 flex-1 items-center gap-2.5 text-sm py-1 px-2">
                        @switch (node.data.kind) {
                            @case ('collection') {
                                <i class="pi pi-box text-xs text-muted-color" aria-hidden="true"></i>
                            }
                            @case ('folder') {
                                <i class="pi pi-folder text-xs text-muted-color" aria-hidden="true"></i>
                            }
                            @case ('request') {
                                <!--                                <i class="pi pi-envelope text-xs text-muted-color" aria-hidden="true"></i>-->
                                <app-method-badge [method]="node.data.method" [compact]="true" />
                            }
                        }
                        <span class="min-w-0 flex-1 truncate" [class.font-medium]="node.data.kind === 'collection'">{{ node.label }}</span>
                        @if (node.data.error) {
                            <i class="pi pi-exclamation-triangle text-xs text-orange-600 dark:text-orange-400" [pTooltip]="node.data.error" aria-hidden="true"></i>
                            <span class="sr-only">(invalid file: {{ node.data.error }})</span>
                        }
                        <!-- Atalho de mouse para o menu de contexto; teclado usa a tecla de menu/Shift+F10. -->
                        <span class="otto-icon-button invisible h-5! w-5! group-hover:visible hover:bg-(transparent)" aria-hidden="true" (click)="openMenuFor(node, $event)">
                            <i class="pi pi-ellipsis-h text-xs"></i>
                        </span>
                    </span>
                </ng-template>
            </p-tree>
        } @else {
            <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                <i class="pi pi-box text-3xl! text-muted-color" aria-hidden="true"></i>
                <p class="m-0 text-sm text-muted-color">This workspace has no collections yet.</p>
                <div class="flex flex-col gap-2">
                    <p-button label="Create Collection" icon="pi pi-plus" size="small" (onClick)="ui.newCollectionDialog.set(true)" />
                    <p-button label="Import Collection" icon="pi pi-download" size="small" severity="secondary" [outlined]="true" (onClick)="ui.importCollectionDialog.set(true)" />
                </div>
            </div>
        }

        <p-context-menu #contextMenu [model]="contextItems()" appendTo="body" />
        <p-menu #addMenu [model]="addItems" [popup]="true" appendTo="#collections-sidebar" />
        <p-menu #moreMenu [model]="moreItems()" [popup]="true" appendTo="#collections-sidebar" />
    `,
    host: {
        id: 'collections-sidebar',
        role: 'navigation',
        'aria-labelledby': 'collections-heading',
        class: 'flex min-h-0 flex-col border-r border-surface-200 bg-surface-50 dark:border-surface-800 dark:bg-surface-900'
    },
    styles: `
        ::ng-deep {
            .p-tree-node-label {
                width: 100%;
            }
            .p-tree-node-leaf > .p-tree-node-content .p-tree-node-toggle-button {
                display: none;
            }
        }
    `
})
export class CollectionsSidebar {
    protected readonly collections = inject(CollectionsState);
    protected readonly ui = inject(UiState);
    private readonly tabs = inject(TabsState);
    private readonly files = inject(CollectionFilesGateway);
    private readonly confirm = inject(ConfirmState);
    private readonly messages = inject(MessageService);
    private readonly contextMenu = viewChild.required<ContextMenu>('contextMenu');

    protected readonly filterVisible = signal(false);
    private readonly expanded = signal<ReadonlySet<string>>(new Set());
    private readonly menuTarget = signal<SidebarNodeData | null>(null);

    protected readonly nodes = computed(() => buildSidebarNodes(this.collections.opened(), this.expanded()));

    /** A seleção acompanha a aba ativa (requisição aberta). */
    protected readonly selectedNode = computed(() => {
        const tab = this.tabs.active();

        return tab?.kind === 'request' && tab.collectionId && tab.resourceRef ? findNode(this.nodes(), nodeKey({ kind: 'request', collectionId: tab.collectionId, path: tab.resourceRef })) : null;
    });

    protected readonly addItems: MenuItem[] = [
        { label: 'New Collection', icon: 'pi pi-plus', command: () => this.ui.newCollectionDialog.set(true) },
        { label: 'Import Collection', icon: 'pi pi-download', command: () => this.ui.importCollectionDialog.set(true) }
    ];

    protected readonly moreItems = computed<MenuItem[]>(() => [
        // { label: 'Export', icon: 'pi pi-file-export', command: () => this.expanded.set(new Set()), disabled: !this.expanded().size }
        { label: 'Expand All', icon: 'pi pi-plus', command: () => this.expanded.set(new Set()), disabled: !!this.expanded().size }
        // { label: 'Remove All from Workspace', icon: 'pi pi-times', command: () => void this.closeAll(), disabled: !this.collections.opened().length }
    ]);

    protected readonly contextItems = computed<MenuItem[]>(() => {
        const target = this.menuTarget();

        if (!target) {
            return [];
        }

        const create: MenuItem[] = [
            { label: 'New Request', icon: 'pi pi-file-plus', command: () => this.ui.newRequestDialog.set({ collectionId: target.collectionId, folder: folderOf(target) }) },
            { label: 'New Folder', icon: 'pi pi-folder-plus', command: () => this.ui.newFolderDialog.set({ collectionId: target.collectionId, folder: folderOf(target) }) }
        ];

        switch (target.kind) {
            case 'collection':
                return [
                    ...create,
                    { separator: true },
                    { label: 'Overview', icon: 'pi pi-info-circle', command: () => this.openCollectionTab(target.collectionId) },
                    { label: 'Environments', icon: 'pi pi-globe', command: () => this.tabs.open({ kind: 'environments', title: 'Environments', collectionId: target.collectionId }) },
                    {
                        label: 'Export Collection',
                        icon: 'pi pi-upload',
                        items: [
                            { label: 'Otto Backup (ZIP)', icon: 'pi pi-box', command: () => void this.exportCollection(target.collectionId, 'backup') },
                            { label: 'OpenAPI Spec', icon: 'pi pi-file', command: () => void this.exportCollection(target.collectionId, 'openapi') }
                        ]
                    },
                    { separator: true },
                    { label: 'Remove from Workspace', icon: 'pi pi-times', command: () => this.ui.removeCollectionDialog.set(target.collectionId) }
                ];
            case 'folder':
                return [...create, { separator: true }, { label: 'Delete', icon: 'pi pi-trash', command: () => void this.confirmDelete(target) }];
            case 'request':
                return [
                    { label: 'Clone', icon: 'pi pi-copy', command: () => this.openRequest(target) },
                    { label: 'Rename', icon: 'pi pi-pencil', command: () => this.openRequest(target) },
                    { separator: true },
                    { label: 'Delete', icon: 'pi pi-trash', command: () => void this.confirmDelete(target) }
                ];
        }
    });

    constructor() {
        // Revela a requisição ativa: expande a coleção e as pastas acima dela (ex.: abas restauradas).
        effect(() => {
            const tab = this.tabs.active();

            if (tab?.kind !== 'request' || !tab.collectionId || !tab.resourceRef) {
                return;
            }

            const segments = tab.resourceRef.split('/').slice(0, -1);
            const ancestors = [nodeKey({ kind: 'collection', collectionId: tab.collectionId, path: '' }), ...segments.map((_, i) => nodeKey({ kind: 'folder', collectionId: tab.collectionId!, path: segments.slice(0, i + 1).join('/') }))];

            untracked(() => {
                if (ancestors.some((key) => !this.expanded().has(key))) {
                    this.expanded.update((set) => new Set([...set, ...ancestors]));
                }
            });
        });
    }

    protected onSelect({ node }: TreeNodeSelectEvent): void {
        const data = (node as SidebarNode).data!;

        if (data.kind === 'request') {
            this.openRequest(data);
        } else {
            // Pastas e coleções expandem/recolhem ao clicar; a coleção também abre seu Overview.
            this.toggle(node.key!);

            if (data.kind === 'collection') {
                this.openCollectionTab(data.collectionId);
            }
        }
    }

    protected setExpanded(event: TreeNodeExpandEvent | TreeNodeCollapseEvent, expanded: boolean): void {
        const key = event.node.key!;

        this.expanded.update((set) => {
            const next = new Set(set);

            if (expanded) {
                next.add(key);
            } else {
                next.delete(key);
            }

            return next;
        });
    }

    protected onContextMenu({ node }: TreeNodeContextMenuSelectEvent): void {
        this.menuTarget.set((node as SidebarNode).data ?? null);
    }

    protected openMenuFor(node: SidebarNode, event: MouseEvent): void {
        event.stopPropagation();
        this.menuTarget.set(node.data ?? null);
        this.contextMenu().show(event);
    }

    private toggle(key: string): void {
        this.expanded.update((set) => {
            const next = new Set(set);

            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }

            return next;
        });
    }

    private openRequest(data: SidebarNodeData): void {
        const label = findNode(this.nodes(), nodeKey(data))?.label ?? data.path;

        this.tabs.open({ kind: 'request', title: label, collectionId: data.collectionId, resourceRef: data.path });
    }

    private async exportCollection(collectionId: string, format: CollectionExportFormat): Promise<void> {
        const collection = this.collections.find(collectionId);

        if (!collection) {
            return;
        }

        try {
            const file = await this.collections.export(collection.metadata, format);

            if (file) {
                this.messages.add({ severity: 'success', summary: 'Collection exported', detail: file, life: 5000 });
            }
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not export the collection', detail: ipcErrorMessage(error), life: 6000 });
        }
    }

    private openCollectionTab(collectionId: string): void {
        this.tabs.open({ kind: 'collection', title: 'Overview', collectionId });
    }

    private async confirmDelete(target: SidebarNodeData): Promise<void> {
        const name = findNode(this.nodes(), nodeKey(target))?.label ?? target.path;
        const accepted = await this.confirm.ask({
            header: target.kind === 'folder' ? 'Delete folder' : 'Delete request',
            message: target.kind === 'folder' ? `Move the folder "${name}" and everything inside it to the trash?` : `Move the request "${name}" to the trash?`,
            acceptLabel: 'Move to Trash',
            severity: 'danger'
        });

        if (accepted) {
            await this.delete(target);
        }
    }

    private async delete(target: SidebarNodeData): Promise<void> {
        try {
            await this.files.remove(target.collectionId, target.path);

            // Abas de requisições removidas (a própria ou as de dentro da pasta) são fechadas.
            for (const tab of this.tabs.tabs()) {
                if (tab.kind === 'request' && tab.collectionId === target.collectionId && (tab.resourceRef === target.path || tab.resourceRef?.startsWith(`${target.path}/`))) {
                    this.tabs.close(tab.id);
                }
            }
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not delete', detail: ipcErrorMessage(error) });
        }
    }
}
