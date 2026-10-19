import { Component, computed, ElementRef, inject, viewChild } from '@angular/core';
import type { CollectionNode, HttpMethod, TabState } from '@shared/models';
import type { MenuItem } from 'primeng/api';
import { MenuModule, type Menu } from 'primeng/menu';
import { TooltipModule } from 'primeng/tooltip';
import { CollectionsState } from '../core/state/collections.state';
import { TabsState } from '../core/state/tabs.state';
import { UiState } from '../core/state/ui.state';
import { MethodBadge } from '../shared/method-badge';
import { TAB_ICONS } from '../shared/tab-icon';

export const TAB_PANEL_ID = 'otto-tab-panel';

/**
 * Abas do contexto atual. Padrão WAI-ARIA de tabs com foco itinerante:
 * setas/Home/End movem entre abas, Delete fecha. O "×" é atalho de mouse
 * (fora da ordem de tabulação) para não aninhar controles dentro da aba.
 */
@Component({
    selector: 'app-tab-strip',
    imports: [MenuModule, TooltipModule, MethodBadge],
    template: `
        <div #tablist role="tablist" aria-label="Open tabs" class="flex min-w-0 items-end gap-0.5 overflow-x-auto px-2" (keydown)="onKeydown($event)">
            @for (tab of tabs.visibleTabs(); track tab.id) {
                <div
                    role="presentation"
                    class="group relative flex h-8 max-w-60 shrink-0 items-center rounded-t-md border border-b-0 text-sm"
                    [class]="
                        tab.id === tabs.activeId() ? 'border-surface-200 bg-surface-0 text-color dark:border-surface-700 dark:bg-surface-950' : 'border-transparent text-muted-color hover:bg-surface-100 hover:text-color dark:hover:bg-surface-800'
                    "
                    (auxclick)="$event.button === 1 && tabs.close(tab.id)"
                >
                    <button
                        type="button"
                        role="tab"
                        [id]="'tab-' + tab.id"
                        class="flex h-full min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent pl-3 pr-1 text-inherit"
                        [attr.aria-selected]="tab.id === tabs.activeId()"
                        [attr.aria-controls]="panelId"
                        [attr.aria-keyshortcuts]="'Delete'"
                        [tabindex]="tab.id === tabs.activeId() ? 0 : -1"
                        (click)="tabs.activate(tab.id)"
                    >
                        @if (tab.kind === 'request') {
                            <app-method-badge [method]="methodOf(tab)" [compact]="true" class="!min-w-0" />
                        } @else {
                            <i [class]="icons[tab.kind]" class="text-xs" aria-hidden="true"></i>
                        }
                        <span class="truncate" [class.italic]="tab.kind === 'request' && !methodOf(tab)">{{ tab.title }}</span>
                    </button>
                    <span class="otto-icon-button mr-1 h-5! w-5! opacity-0 group-hover:opacity-100" [class.opacity-100]="tab.id === tabs.activeId()" aria-hidden="true" title="Close tab" (click)="tabs.close(tab.id)">
                        <i class="pi pi-times text-[0.625rem]"></i>
                    </span>
                </div>
            }
        </div>
        <button type="button" class="otto-icon-button mb-0.5 shrink-0" [attr.aria-label]="addLabel()" [pTooltip]="addLabel()" tooltipPosition="bottom" aria-haspopup="menu" (click)="add($event)">
            <i class="pi pi-plus text-sm" aria-hidden="true"></i>
        </button>
        <p-menu #addMenu [model]="workspaceAddItems" [popup]="true" appendTo="body" />
    `,
    host: { class: 'flex shrink-0 items-end border-b border-surface-200 dark:border-surface-700' }
})
export class TabStrip {
    protected readonly tabs = inject(TabsState);
    private readonly collections = inject(CollectionsState);
    private readonly ui = inject(UiState);
    private readonly tablist = viewChild.required<ElementRef<HTMLElement>>('tablist');
    private readonly addMenu = viewChild.required<Menu>('addMenu');

    protected readonly panelId = TAB_PANEL_ID;
    protected readonly icons = TAB_ICONS;
    protected readonly addLabel = computed(() => (this.tabs.context() ? 'New request' : 'Open workspace tab'));

    protected readonly workspaceAddItems: MenuItem[] = [
        { label: 'Overview', icon: 'pi pi-home', command: () => this.tabs.open({ kind: 'overview', title: 'Overview', collectionId: null }) },
        { label: 'Environments', icon: 'pi pi-globe', command: () => this.tabs.open({ kind: 'environments', title: 'Environments', collectionId: null }) },
        { label: 'Preferences', icon: 'pi pi-cog', command: () => this.tabs.open({ kind: 'settings', title: 'Preferences', collectionId: null }) }
    ];

    /** Método atual da requisição, lido da árvore (reflete edições feitas fora do app). */
    protected methodOf(tab: TabState): HttpMethod | null {
        return findMethod(this.collections.find(tab.collectionId)?.tree.children ?? [], tab.resourceRef ?? '');
    }

    protected add(event: MouseEvent): void {
        const context = this.tabs.context();

        if (context) {
            this.ui.newRequestDialog.set({ collectionId: context, folder: '' });
        } else {
            this.addMenu().toggle(event);
        }
    }

    protected onKeydown(event: KeyboardEvent): void {
        const visible = this.tabs.visibleTabs();
        const index = visible.findIndex((tab) => tab.id === this.tabs.activeId());
        let next: number | null = null;

        switch (event.key) {
            case 'ArrowRight':
                next = (index + 1) % visible.length;
                break;
            case 'ArrowLeft':
                next = (index - 1 + visible.length) % visible.length;
                break;
            case 'Home':
                next = 0;
                break;
            case 'End':
                next = visible.length - 1;
                break;
            case 'Delete':
                if (index >= 0) {
                    this.tabs.close(visible[index]!.id);
                    this.focusActive();
                }

                event.preventDefault();

                return;
            default:
                return;
        }

        event.preventDefault();
        this.tabs.activate(visible[next]!.id);
        this.focusActive();
    }

    private focusActive(): void {
        queueMicrotask(() => this.tablist().nativeElement.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus());
    }
}

function findMethod(nodes: readonly CollectionNode[], path: string): HttpMethod | null {
    for (const node of nodes) {
        if (node.type === 'request' && node.path === path) {
            return node.method;
        }

        if (node.type === 'folder') {
            const found = findMethod(node.children, path);

            if (found) {
                return found;
            }
        }
    }

    return null;
}
