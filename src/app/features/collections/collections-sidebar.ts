import { afterNextRender, Component, computed, effect, ElementRef, inject, Injector, signal, untracked, viewChild } from '@angular/core';
import { MessageService, PrimeTemplate, TreeDragDropService, type MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ContextMenu, ContextMenuModule } from 'primeng/contextmenu';
import { MenuModule } from 'primeng/menu';
import { TieredMenuModule } from 'primeng/tieredmenu';
import { TooltipModule } from 'primeng/tooltip';
import { TreeModule } from 'primeng/tree';
import type { TreeNodeCollapseEvent, TreeNodeContextMenuSelectEvent, TreeNodeDropEvent, TreeNodeExpandEvent, TreeNodeSelectEvent } from 'primeng/types/tree';
import type { CollectionExportFormat } from '@shared/models';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { registerCommand, type CommandContext } from '../../core/keyboard/command-registry';
import { CollectionFilesGateway } from '../../core/ports';
import { CollectionsState } from '../../core/state/collections.state';
import { ConfirmState } from '../../core/state/confirm.state';
import { draftKey, RequestDraftsState } from '../../core/state/request-drafts.state';
import { TabsState } from '../../core/state/tabs.state';
import { UiState } from '../../core/state/ui.state';
import { MethodBadge } from '../../shared/method-badge';
import { TreeToggleLabel } from '../../shared/tree-toggle-label.directive';
import { buildCollectionRoot, findNode, folderOf, dropPositionOf, nodeKey, parentKey, pathInFolder, resolveDrop, type SidebarNode, type SidebarNodeData } from './collection-tree-nodes';
import { copyName } from '../../shared/copy-name';
import { NameDialog, type NameRequest } from '../../shared/name-dialog';

const EXPANDED_KEY = 'otto.sidebarExpanded';

function localStorageHas(key: string): boolean {
    try {
        return localStorage.getItem(key) !== null;
    } catch {
        return false;
    }
}

/** Nós expandidos da última sessão; `localStorage` pode estar indisponível ou corrompido. */
function readExpanded(): ReadonlySet<string> {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]');

        return new Set(Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : []);
    } catch {
        return new Set();
    }
}

/**
 * Barra lateral. Com uma coleção aberta (contexto das abas): só as pastas e requisições dela em
 * árvore, com ações por contexto, e o botão voltar. Sem coleção aberta:
 * só uma dica (as coleções são escolhidas nos cards da área principal).
 */
@Component({
    selector: 'app-collections-sidebar',
    imports: [TreeModule, PrimeTemplate, ContextMenuModule, MenuModule, TieredMenuModule, ButtonModule, TooltipModule, MethodBadge, TreeToggleLabel, NameDialog],
    // O `p-tree` injeta o serviço como opcional: sem ele o arrastar e soltar não funciona.
    providers: [TreeDragDropService],
    template: `
        @if (collection(); as current) {
            <div class="flex items-center gap-1 h-9 px-2 border-b border-surface-200 dark:border-surface-800 py-5">
                <button type="button" class="otto-icon-button shrink-0" aria-label="Back to collections" pTooltip="Back to collections" tooltipPosition="bottom" (click)="back()">
                    <i class="pi pi-chevron-left text-sm" aria-hidden="true"></i>
                </button>
                <div class="flex min-w-0 flex-1 items-center gap-2">
                    <i class="pi pi-box text-sm text-muted-color" aria-hidden="true"></i>
                    <h2 id="collections-heading" class="m-0 min-w-0 flex-1 truncate text-sm font-semibold" [title]="collection()?.metadata?.name ?? ''">{{ collection()?.metadata?.name }}</h2>
                </div>
                <div class="flex shrink-0 flex-row justify-end gap-1">
                    <button type="button" class="otto-icon-button" [attr.aria-pressed]="filterVisible()" aria-label="Search requests" pTooltip="Search" tooltipPosition="bottom" (click)="filterVisible.set(!filterVisible())">
                        <i class="pi pi-search text-sm" aria-hidden="true"></i>
                    </button>
                    <button type="button" class="otto-icon-button" aria-label="Add to collection" aria-haspopup="menu" pTooltip="New request or folder" tooltipPosition="bottom" (click)="addMenu.toggle($event)">
                        <i class="pi pi-plus text-sm" aria-hidden="true"></i>
                    </button>
                    <button type="button" class="otto-icon-button" aria-label="More collection actions" aria-haspopup="menu" (click)="moreMenu.toggle($event)">
                        <i class="pi pi-ellipsis-v text-sm" aria-hidden="true"></i>
                    </button>
                </div>
            </div>

            @if (nodes().length) {
                <!--
                    scrollHeight="flex": o .p-tree-root (overflow auto) ocupa toda a altura e é o ÚNICO contêiner
                    de rolagem, com as duas barras nas bordas da barra lateral (a horizontal no rodapé, não onde a
                    lista termina). O host não rola; o filtro fica fixo no topo.
                -->
                <p-tree
                    class="otto-sidebar-tree min-h-0 flex-1 overflow-hidden"
                    styleClass="!bg-transparent !p-1"
                    scrollHeight="flex"
                    [value]="nodes()"
                    selectionMode="single"
                    [selection]="selectedNode()"
                    [filter]="filterVisible()"
                    filterMode="lenient"
                    filterPlaceholder="Filter requests"
                    ariaLabelledBy="collections-heading"
                    appTreeToggleLabel
                    [draggableNodes]="!filterVisible() && !moving()"
                    droppableNodes
                    [validateDrop]="true"
                    [contextMenu]="contextMenu"
                    (onNodeSelect)="onSelect($event)"
                    (onNodeExpand)="setExpanded($event, true)"
                    (onNodeCollapse)="setExpanded($event, false)"
                    (onNodeContextMenuSelect)="onContextMenu($event)"
                    (onNodeDrop)="onDrop($event)"
                >
                    <ng-template pTemplate="otto" let-node>
                        <span class="group flex min-w-0 flex-1 items-center gap-2.5 text-sm py-1 px-2" [attr.data-node-key]="node.key">
                            @switch (node.data.kind) {
                                @case ('folder') {
                                    <i class="pi text-xs text-muted-color" [class]="node.expanded ? 'pi-folder-open' : 'pi-folder'" aria-hidden="true"></i>
                                }
                                @case ('request') {
                                    <!--                                <i class="pi pi-envelope text-xs text-muted-color" aria-hidden="true"></i>-->
                                    <app-method-badge [method]="node.data.method" [compact]="true" />
                                }
                            }
                            <span class="otto-tree-label truncate">{{ node.label }}</span>
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
            } @else if (collection(); as current) {
                <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                    <i class="pi pi-send text-3xl! text-muted-color" aria-hidden="true"></i>
                    <p class="m-0 text-sm text-muted-color">This collection has no requests yet.</p>
                    <div class="flex flex-col gap-2">
                        <p-button label="New Request" icon="pi pi-plus" size="small" (onClick)="ui.newRequestDialog.set({ collectionId: current.metadata.id, folder: '' })" />
                        <p-button label="New Folder" icon="pi pi-folder-plus" size="small" severity="secondary" [outlined]="true" (onClick)="ui.newFolderDialog.set({ collectionId: current.metadata.id, folder: '' })" />
                    </div>
                </div>
            }
        } @else {
            <div class="flex items-center gap-2 h-9 px-2 border-b border-surface-200 dark:border-surface-800 py-5">
                <i class="pi pi-box text-sm text-muted-color" aria-hidden="true"></i>
                <h2 id="collections-heading" class="m-0 flex-1 text-sm font-semibold">Collections</h2>
                <button type="button" class="otto-icon-button" aria-label="Add collection" aria-haspopup="menu" pTooltip="Add collection" tooltipPosition="bottom" (click)="addMenu.toggle($event)">
                    <i class="pi pi-plus text-sm" aria-hidden="true"></i>
                </button>
            </div>

            <!-- Sem coleção aberta, a escolha é feita nos cards da área principal; a barra lateral só aguarda. -->
            <div class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <i class="pi pi-box text-3xl! text-muted-color" aria-hidden="true"></i>
                <p class="m-0 text-sm text-muted-color">{{ collections.opened().length ? 'Select a collection to see its requests.' : 'This workspace has no collections yet.' }}</p>
            </div>
        }

        <p-context-menu #contextMenu [model]="contextItems()" appendTo="body" />
        <p-menu #addMenu [model]="addItems()" [popup]="true" appendTo="#collections-sidebar" />
        <p-tiered-menu #moreMenu [model]="moreItems()" [popup]="true" appendTo="body" />
        <app-name-dialog [(request)]="nameDialog" />
    `,
    host: {
        id: 'collections-sidebar',
        role: 'navigation',
        'aria-labelledby': 'collections-heading',
        class: 'flex min-h-0 flex-col border-r border-surface-200 bg-surface-50 dark:border-surface-800 dark:bg-surface-900'
    },
    styles: `
        /*
         * Sem min-height: 0, o item flex (.p-tree-root) cresceria até a altura do conteúdo e a rolagem
         * voltaria para fora dele. A lista raiz tem a largura da linha mais larga (max-content; no mínimo
         * a da barra): todas as linhas vão até a mesma borda, então hover e seleção não cortam ao rolar
         * para o lado. O nome não entra nessa conta (largura 0, mínimo 3rem; ver .otto-tree-label): a barra
         * horizontal só surge quando a pasta mais funda não cabe, e os nomes seguem truncados com "…".
         */
        :host ::ng-deep .otto-sidebar-tree .p-tree-root {
            min-height: 0;
        }

        :host ::ng-deep .otto-sidebar-tree .p-tree-root-children {
            width: max-content;
            min-width: 100%;
        }

        .otto-tree-label {
            width: 0;
            min-width: 3rem;
            flex-grow: 1;
        }

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
    protected readonly tabs = inject(TabsState);
    private readonly files = inject(CollectionFilesGateway);
    private readonly confirm = inject(ConfirmState);
    private readonly drafts = inject(RequestDraftsState);
    private readonly messages = inject(MessageService);
    private readonly contextMenu = viewChild.required<ContextMenu>('contextMenu');
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    private readonly injector = inject(Injector);

    protected readonly filterVisible = signal(false);
    private readonly expanded = signal(readExpanded());
    private readonly menuTarget = signal<SidebarNodeData | null>(null);
    /** Enquanto um arraste é gravado no disco, novos arrastes ficam bloqueados. */
    protected readonly moving = signal(false);
    /** Diálogo de nome aberto (renomear ou duplicar). */
    protected readonly nameDialog = signal<NameRequest | null>(null);

    /** Coleção aberta (contexto das abas); as demais não aparecem na barra lateral. */
    protected readonly collection = computed(() => this.collections.find(this.tabs.context()));
    /** Raiz sintética da coleção (não exibida): pai dos itens de primeiro nível. */
    private readonly root = computed(() => {
        const collection = this.collection();

        return collection ? buildCollectionRoot(collection, this.expanded()) : null;
    });
    protected readonly nodes = computed(() => (this.root()?.children ?? []) as SidebarNode[]);

    /** A seleção acompanha a aba ativa (requisição aberta). */
    protected readonly selectedNode = computed(() => {
        const tab = this.tabs.active();

        return tab?.kind === 'request' && tab.collectionId && tab.resourceRef ? findNode(this.nodes(), nodeKey({ kind: 'request', collectionId: tab.collectionId, path: tab.resourceRef })) : null;
    });

    protected readonly addItems = computed<MenuItem[]>(() => {
        const collectionId = this.collection()?.metadata.id;

        return collectionId
            ? [
                  { label: 'New Request', icon: 'pi pi-file-plus', command: () => this.ui.newRequestDialog.set({ collectionId, folder: '' }) },
                  { label: 'New Folder', icon: 'pi pi-folder-plus', command: () => this.ui.newFolderDialog.set({ collectionId, folder: '' }) }
              ]
            : [
                  { label: 'New Collection', icon: 'pi pi-plus', command: () => this.ui.newCollectionDialog.set(true) },
                  { label: 'Import Collection', icon: 'pi pi-download', command: () => this.ui.importCollectionDialog.set(true) }
              ];
    });

    protected readonly moreItems = computed<MenuItem[]>(() => {
        const collectionId = this.collection()?.metadata.id;

        if (!collectionId) {
            return [];
        }

        const root: SidebarNodeData = { kind: 'collection', collectionId, path: '', method: null, error: null };

        return [
            { label: 'Overview', icon: 'pi pi-info-circle', command: () => this.openCollectionTab(collectionId) },
            { label: 'Environments', icon: 'pi pi-globe', command: () => this.tabs.open({ kind: 'environments', title: 'Environments', collectionId }) },
            { label: 'Reveal in File Explorer', icon: 'pi pi-folder-open', command: () => void this.reveal(root) },
            {
                label: 'Export Collection',
                icon: 'pi pi-upload',
                items: [
                    { label: 'Otto Backup (ZIP)', icon: 'pi pi-box', command: () => void this.exportCollection(collectionId, 'backup') },
                    { label: 'OpenAPI Spec', icon: 'pi pi-file', command: () => void this.exportCollection(collectionId, 'openapi') }
                ]
            },
            { separator: true },
            { label: 'Collapse All', icon: 'pi pi-minus', command: () => this.collapseAll(), disabled: !this.hasExpanded() },
            { separator: true },
            { label: 'Back to Collections', icon: 'pi pi-arrow-left', command: () => this.back() },
            { label: 'Remove from Workspace', icon: 'pi pi-times', command: () => this.ui.removeCollectionDialog.set(collectionId) }
        ];
    });

    /** Alguma pasta desta coleção está expandida. */
    private readonly hasExpanded = computed(() => {
        const id = this.collection()?.metadata.id;
        const prefix = `folder:${id}:`;

        return !!id && [...this.expanded()].some((key) => key.startsWith(prefix));
    });

    protected readonly contextItems = computed<MenuItem[]>(() => {
        const target = this.menuTarget();

        if (!target) {
            return [];
        }

        const create: MenuItem[] = [
            { label: 'New Request', icon: 'pi pi-file-plus', command: () => this.ui.newRequestDialog.set({ collectionId: target.collectionId, folder: folderOf(target) }) },
            { label: 'New Folder', icon: 'pi pi-folder-plus', command: () => this.ui.newFolderDialog.set({ collectionId: target.collectionId, folder: folderOf(target) }) }
        ];
        const edit: MenuItem[] = [
            { label: 'Duplicate', icon: 'pi pi-copy', command: () => this.askDuplicate(target) },
            { label: 'Rename', icon: 'pi pi-pencil', command: () => this.askRename(target) }
        ];
        const remove: MenuItem = { label: 'Delete', icon: 'pi pi-trash', command: () => void this.confirmDelete(target) };
        const reveal: MenuItem = { label: 'Reveal in File Explorer', icon: 'pi pi-folder-open', command: () => void this.reveal(target) };

        switch (target.kind) {
            case 'collection':
                return [];
            case 'folder':
                return [
                    { label: 'Folder Settings', icon: 'pi pi-sliders-h', command: () => this.tabs.open({ kind: 'folder', title: target.path.split('/').pop() ?? target.path, collectionId: target.collectionId, resourceRef: target.path }) },
                    { separator: true },
                    ...create,
                    { separator: true },
                    ...edit,
                    reveal,
                    { separator: true },
                    remove
                ];
            case 'request':
                return [{ label: 'Open', icon: 'pi pi-file', command: () => this.openRequest(target) }, ...edit, reveal, { separator: true }, remove];
        }
    });

    constructor() {
        // Atalhos da árvore (F2, Delete, Mod+D) agem sobre o item focado.
        const editable = (context: CommandContext) => {
            const target = this.focusedNode(context);

            return target && target.kind !== 'collection' ? target : null;
        };

        registerCommand('sidebar.rename', { when: (context) => !!editable(context), run: (context) => this.askRename(editable(context)!) });
        registerCommand('sidebar.duplicate', { when: (context) => !!editable(context), run: (context) => this.askDuplicate(editable(context)!) });
        registerCommand('sidebar.delete', {
            when: (context) => !!editable(context),
            run: (context) => this.confirmDelete(editable(context)!)
        });

        // O estado de expansão da árvore sobrevive ao fechar o app.
        effect(() => {
            const keys = [...this.expanded()];

            try {
                localStorage.setItem(EXPANDED_KEY, JSON.stringify(keys));
            } catch {
                // Sem armazenamento: o estado vale só nesta sessão.
            }
        });

        // Pedido de foco vindo dos atalhos `sidebar.focus` / `sidebar.filter`.
        effect(() => {
            const request = this.ui.sidebarFocusRequest();

            if (!request) {
                return;
            }

            untracked(() => {
                this.ui.sidebarFocusRequest.set(null);

                if (request.filter) {
                    this.filterVisible.set(true);
                }

                afterNextRender(() => this.focusTree(request.filter), { injector: this.injector });
            });
        });

        // Revela a requisição ativa ao trocar de aba: expande a coleção e as pastas acima dela.
        // Só reage à troca da requisição (não a edições da aba), e a aba restaurada ao iniciar
        // não sobrescreve a expansão salva da última sessão.
        const activeRequest = computed(
            () => {
                const tab = this.tabs.active();

                return tab?.kind === 'request' && tab.collectionId && tab.resourceRef ? { collectionId: tab.collectionId, path: tab.resourceRef } : null;
            },
            { equal: (a, b) => a?.collectionId === b?.collectionId && a?.path === b?.path }
        );
        let restored = localStorageHas(EXPANDED_KEY);

        effect(() => {
            const request = activeRequest();

            if (!request) {
                return;
            }

            if (restored) {
                restored = false;

                return;
            }

            const segments = request.path.split('/').slice(0, -1);
            const ancestors = segments.map((_, i) => nodeKey({ kind: 'folder', collectionId: request.collectionId, path: segments.slice(0, i + 1).join('/') }));

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
            // Pastas expandem/recolhem ao clicar.
            this.toggle(node.key!);
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

    /**
     * Arrastar e soltar requisições e pastas dentro da mesma coleção. O item vai para a
     * pasta (ou raiz da coleção) de destino, na posição exata em que foi solto: a nova
     * ordem de todos os itens da pasta é gravada (`seq` das requisições e `_folder.yaml`).
     * A árvore não é alterada localmente (`validateDrop` sem `accept`): ela é relida do disco.
     */
    protected async onDrop({ originalEvent, dragNode, dropNode }: TreeNodeDropEvent): Promise<void> {
        const dragged = (dragNode as SidebarNode | null | undefined)?.data;

        if (!originalEvent || !dragNode || !dropNode || !dragged || dragged.kind === 'collection') {
            return;
        }

        const root = this.root();
        const target = root ? resolveDrop(dragNode as SidebarNode, dropNode as SidebarNode, dropPositionOf(originalEvent), root) : null;
        const parent = target?.parent.data;

        if (!target || !parent) {
            return;
        }

        const { collectionId } = dragged;
        const to = pathInFolder(parent.path, dragged.path);

        this.moving.set(true);

        try {
            if (to !== dragged.path) {
                await this.files.move(collectionId, dragged.path, to);
                this.relocate(collectionId, dragged.path, to);

                if (parent.kind === 'folder') {
                    this.expanded.update((set) => new Set([...set, nodeKey(parent)]));
                }
            }

            await this.reorder(
                collectionId,
                target.children.map(({ data }) => (data!.path === dragged.path ? to : data!.path))
            );
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not move', detail: ipcErrorMessage(error), life: 6000 });
        } finally {
            await this.collections.refresh(collectionId);
            this.moving.set(false);
        }
    }

    /** Grava a ordem final dos itens da pasta; rascunhos abertos recebem o novo `seq` para não desfazê-la ao salvar. */
    private async reorder(collectionId: string, paths: string[]): Promise<void> {
        await this.files.reorder(collectionId, paths);

        for (const [index, path] of paths.entries()) {
            this.drafts.patch(draftKey(collectionId, path), (draft) => ({ ...draft, seq: index + 1 }));
        }
    }

    /** Abas, rascunhos e pastas expandidas do item movido (e do que há dentro dele) seguem o novo caminho. */
    private relocate(collectionId: string, from: string, to: string): void {
        const folderFrom = nodeKey({ kind: 'folder', collectionId, path: from });
        const folderTo = nodeKey({ kind: 'folder', collectionId, path: to });

        this.drafts.relocate(collectionId, from, to);
        this.expanded.update((set) => new Set([...set].map((key) => (key === folderFrom || key.startsWith(`${folderFrom}/`) ? folderTo + key.slice(folderFrom.length) : key))));

        for (const tab of this.tabs.tabs()) {
            if ((tab.kind === 'request' || tab.kind === 'folder') && tab.collectionId === collectionId && tab.resourceRef && (tab.resourceRef === from || tab.resourceRef.startsWith(`${from}/`))) {
                this.tabs.update(tab.id, { resourceRef: to + tab.resourceRef.slice(from.length) });
            }
        }
    }

    /** Nó da árvore que tem o foco (o `treeitem` do PrimeNG contém o template do próprio nó antes dos filhos). */
    private focusedNode({ target }: CommandContext): SidebarNodeData | null {
        const item = target?.closest('[role="treeitem"]');
        const key = item && this.host.contains(item) ? item.querySelector('[data-node-key]')?.getAttribute('data-node-key') : null;

        return key ? (this.find(key)?.data ?? null) : null;
    }

    private focusTree(filter: boolean): void {
        const target = filter
            ? this.host.querySelector<HTMLElement>('p-tree input')
            : (this.host.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]') ?? this.host.querySelector<HTMLElement>('[role="treeitem"]') ?? this.host.querySelector<HTMLElement>('p-button button'));

        target?.focus();
    }

    private askDuplicate(target: SidebarNodeData): void {
        const folder = target.kind === 'folder';

        this.nameDialog.set({
            header: folder ? 'Duplicate Folder' : 'Duplicate Request',
            acceptLabel: 'Duplicate',
            acceptIcon: 'pi pi-copy',
            // Sugestão única entre os itens da mesma pasta (o usuário pode mudar antes de confirmar).
            name: copyName(this.labelOf(target), this.siblingLabels(target)),
            folder,
            submit: (name) => this.duplicate(target, name)
        });
    }

    private askRename(target: SidebarNodeData): void {
        const folder = target.kind === 'folder';

        this.nameDialog.set({
            header: folder ? 'Rename Folder' : 'Rename Request',
            acceptLabel: 'Rename',
            acceptIcon: 'pi pi-check',
            name: this.labelOf(target),
            folder,
            submit: (name) => this.rename(target, name)
        });
    }

    /** A cópia fica logo abaixo do original; uma requisição duplicada já abre numa aba. */
    private async duplicate(target: SidebarNodeData, name: string): Promise<void> {
        const { collectionId } = target;
        const created = await this.files.duplicate(collectionId, target.path, name);

        try {
            const siblings = this.siblingPaths(target).filter((path) => path !== created);
            const index = siblings.indexOf(target.path) + 1;

            await this.reorder(collectionId, [...siblings.slice(0, index), created, ...siblings.slice(index)]);
        } catch (error) {
            // A cópia já existe; só a posição dela não foi gravada.
            this.messages.add({ severity: 'warn', summary: 'Duplicated, but could not reorder', detail: ipcErrorMessage(error), life: 6000 });
        } finally {
            await this.collections.refresh(collectionId);
        }

        if (target.kind === 'request') {
            this.tabs.open({ kind: 'request', title: name, collectionId, resourceRef: created });
        }
    }

    /** Abas, rascunhos e pastas expandidas seguem o novo caminho; o nome da requisição também vai para o rascunho e a aba. */
    private async rename(target: SidebarNodeData, name: string): Promise<void> {
        const { collectionId } = target;
        const to = await this.files.rename(collectionId, target.path, name);

        if (to !== target.path) {
            this.relocate(collectionId, target.path, to);
        }

        if (target.kind === 'request') {
            this.drafts.patch(draftKey(collectionId, to), (draft) => ({ ...draft, name }));

            for (const tab of this.tabs.tabs()) {
                if (tab.kind === 'request' && tab.collectionId === collectionId && tab.resourceRef === to) {
                    this.tabs.update(tab.id, { title: name });
                }
            }
        } else if (target.kind === 'folder') {
            for (const tab of this.tabs.tabs()) {
                if (tab.kind === 'folder' && tab.collectionId === collectionId && tab.resourceRef === to) {
                    this.tabs.update(tab.id, { title: to.split('/').pop() ?? name });
                }
            }
        }

        await this.collections.refresh(collectionId);
    }

    /** Caminhos dos itens da mesma pasta do alvo, na ordem atual da árvore. */
    private siblingPaths(target: SidebarNodeData): string[] {
        return ((this.find(parentKey(target))?.children ?? []) as SidebarNode[]).map(({ data }) => data!.path);
    }

    private siblingLabels(target: SidebarNodeData): string[] {
        return ((this.find(parentKey(target))?.children ?? []) as SidebarNode[]).map((node) => node.label ?? '');
    }

    private labelOf(target: SidebarNodeData): string {
        return this.find(nodeKey(target))?.label ?? target.path;
    }

    /** Busca a partir da raiz da coleção (que também é encontrada, para os itens de primeiro nível). */
    private find(key: string): SidebarNode | null {
        const root = this.root();

        return root ? findNode([root], key) : null;
    }

    protected back(): void {
        this.tabs.setContext(null);
    }

    /** Recolhe as pastas desta coleção (as das outras continuam como estavam). */
    private collapseAll(): void {
        const prefix = `folder:${this.collection()?.metadata.id}:`;

        this.expanded.update((set) => new Set([...set].filter((key) => !key.startsWith(prefix))));
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
        this.tabs.open({ kind: 'request', title: this.labelOf(data), collectionId: data.collectionId, resourceRef: data.path });
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

    private async reveal(target: SidebarNodeData): Promise<void> {
        try {
            await this.files.reveal(target.collectionId, target.path);
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not reveal in file explorer', detail: ipcErrorMessage(error), life: 6000 });
        }
    }

    private openCollectionTab(collectionId: string): void {
        this.tabs.open({ kind: 'collection', title: 'Overview', collectionId });
    }

    private async confirmDelete(target: SidebarNodeData): Promise<void> {
        const name = this.labelOf(target);
        const accepted = await this.confirm.ask({
            header: target.kind === 'folder' ? 'Delete folder' : 'Delete request',
            message: target.kind === 'folder' ? `Move the folder "${name}" and everything inside it to the trash?` : `Move the request "${name}" to the trash?`,
            acceptLabel: 'Move to Trash',
            acceptIcon: 'pi pi-trash',
            detail: 'It can be restored from the system trash.',
            severity: 'danger'
        });

        if (accepted) {
            await this.delete(target);
        }
    }

    private async delete(target: SidebarNodeData): Promise<void> {
        try {
            await this.files.remove(target.collectionId, target.path);

            // Abas de requisições e pastas removidas (a própria ou as de dentro da pasta) são fechadas.
            for (const tab of this.tabs.tabs()) {
                if ((tab.kind === 'request' || tab.kind === 'folder') && tab.collectionId === target.collectionId && (tab.resourceRef === target.path || tab.resourceRef?.startsWith(`${target.path}/`))) {
                    this.tabs.close(tab.id);
                }
            }
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not delete', detail: ipcErrorMessage(error) });
        }
    }
}
