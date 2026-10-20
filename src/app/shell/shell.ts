import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import type { MenuAction } from '@shared/models';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { MenuEventsGateway } from '../core/ports';
import { CollectionsState } from '../core/state/collections.state';
import { TabsState } from '../core/state/tabs.state';
import { UiState } from '../core/state/ui.state';
import { WorkspacesState } from '../core/state/workspaces.state';
import { RequestDraftsState } from '../core/state/request-drafts.state';
import { ThemeService } from '../core/theme/theme.service';
import { CollectionsSidebar } from '../features/collections/collections-sidebar';
import { NewCollectionDialog } from '../features/collections/new-collection-dialog';
import { NewFolderDialog } from '../features/collections/new-folder-dialog';
import { NewRequestDialog } from '../features/collections/new-request-dialog';
import { ImportCollectionDialog } from '../features/collections/import-collection-dialog';
import { RemoveCollectionDialog } from '../features/collections/remove-collection-dialog';
import { ImportWorkspaceDialog } from '../features/workspace/import-workspace-dialog';
import { NewWorkspaceDialog } from '../features/workspace/new-workspace-dialog';
import { SettingsDialog } from '../features/settings/settings-dialog.service';
import { ConfirmHost } from './confirm-host';
import { ContextHeader } from './context-header';
import { StatusBar } from './status-bar';
import { TabHost } from './tab-host';
import { TabStrip } from './tab-strip';
import { TitleBar } from './title-bar';
import { SplitterModule } from 'primeng/splitter';
import type { SplitterPassThrough, SplitterResizeEndEvent } from 'primeng/types/splitter';

const SIDEBAR_SPLITTER_KEY = 'otto.splitter.sidebar';

/** Primeiro tamanho (%) salvo pelo `stateKey` do splitter; `localStorage` pode estar indisponível. */
function savedSplitterSize(key: string, fallback: number): number {
    try {
        const sizes: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');

        return Array.isArray(sizes) && typeof sizes[0] === 'number' ? sizes[0] : fallback;
    } catch {
        return fallback;
    }
}

/**
 * Layout principal (estilo Bruno): barra de título, coleções à esquerda e, à
 * direita, cabeçalho do contexto + abas + conteúdo; barra de status no rodapé.
 */
@Component({
    selector: 'app-shell',
    imports: [
        TitleBar,
        CollectionsSidebar,
        ContextHeader,
        TabStrip,
        TabHost,
        StatusBar,
        NewCollectionDialog,
        NewRequestDialog,
        NewFolderDialog,
        NewWorkspaceDialog,
        ImportWorkspaceDialog,
        ImportCollectionDialog,
        RemoveCollectionDialog,
        ConfirmHost,
        ToastModule,
        SplitterModule,
        NgTemplateOutlet
    ],
    providers: [MessageService],
    template: `
        <app-title-bar />
        <!-- Barra lateral redimensionável; oculta, o conteúdo ocupa tudo (o splitter sempre tem 2 painéis). -->
        @if (ui.sidebarVisible()) {
            <!--
                O <main> envolve o splitter: o divisor entre a barra lateral e o conteúdo precisa estar
                dentro de um landmark (axe "region"), e um <header> interno não vira banner.
            -->
            <main id="main-content" class="flex min-h-0 flex-1">
                <p-splitter
                    [pt]="sidebarSplitterPt()"
                    [panelSizes]="sidebarSizes"
                    [minSizes]="sidebarSizesMinSizes"
                    [stateKey]="sidebarStateKey"
                    stateStorage="local"
                    (onResizeEnd)="sidebarSize.set(firstSize($event))"
                    class="main-splitter min-h-0 min-w-0 flex-1"
                    styleClass="h-full !rounded-none !border-0 !bg-transparent [&>.p-splitterpanel]:min-h-0 [&>.p-splitterpanel]:min-w-0 [&>.p-splitterpanel]:overflow-hidden"
                >
                    <ng-template #panel>
                        <app-collections-sidebar class="h-full w-full border-r-0!" />
                    </ng-template>
                    <ng-template #panel>
                        <ng-container *ngTemplateOutlet="mainContent" />
                    </ng-template>
                </p-splitter>
            </main>
        } @else {
            <main class="flex min-h-0 flex-1">
                <ng-container *ngTemplateOutlet="mainContent" />
            </main>
        }

        <ng-template #mainContent>
            <div class="flex h-full min-w-0 flex-1 flex-col bg-surface-0 dark:bg-surface-950">
                <app-context-header />
                <app-tab-strip />
                <app-tab-host />
            </div>
        </ng-template>
        <app-status-bar />

        <app-new-collection-dialog />
        <app-new-request-dialog />
        <app-new-folder-dialog />
        <app-new-workspace-dialog />
        <app-import-workspace-dialog />
        <app-import-collection-dialog />
        <app-remove-collection-dialog />
        <p-toast position="top-right" />
        <app-confirm-host />
    `,
    host: {
        class: 'flex h-screen flex-col text-color',
        '(document:keydown)': 'onKeydown($event)'
    },
    styles: `
        //::ng-deep {
        //    .main-splitter {
        //        > .p-splitter-gutter {
        //            //background: var(--p-primary-color);
        //            background: var(--p-primary-color);
        //        }
        //    }
        //}
    `
})
export class Shell {
    protected readonly ui = inject(UiState);

    protected readonly sidebarStateKey = SIDEBAR_SPLITTER_KEY;
    protected readonly sidebarSizes = [15, 85];
    protected readonly sidebarSizesMinSizes = [5, 5];
    /** Largura da barra lateral (%), para o `aria-valuenow` do divisor; começa pelo tamanho salvo. */
    protected readonly sidebarSize = signal(savedSplitterSize(SIDEBAR_SPLITTER_KEY, this.sidebarSizes[0]!));
    /**
     * O PrimeNG põe `role="separator"` no divisor e o foco/teclado no puxador interno, que só
     * recebe `aria-valuenow` durante o arraste (axe). O puxador vira o separador acessível.
     */
    protected readonly firstSize = (event: SplitterResizeEndEvent): number => Number(event.sizes[0]);
    protected readonly sidebarSplitterPt = computed<SplitterPassThrough>(() => ({
        panel: {},
        gutter: { role: 'none' },
        gutterHandle: { role: 'separator', 'aria-label': 'Resize sidebar', 'aria-orientation': 'vertical', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(this.sidebarSize()) }
    }));

    private readonly tabs = inject(TabsState);
    private readonly collections = inject(CollectionsState);
    private readonly theme = inject(ThemeService);
    private readonly messages = inject(MessageService);
    private readonly workspaces = inject(WorkspacesState);
    private readonly settingsDialog = inject(SettingsDialog);
    /** Também registra a confirmação ao fechar abas com alterações não salvas. */
    private readonly drafts = inject(RequestDraftsState);

    constructor() {
        void this.workspaces.load();

        inject(DestroyRef).onDestroy(inject(MenuEventsGateway).onMenuAction((action) => this.onMenuAction(action)));

        // Falhas de abrir/criar coleções (pasta inválida, sem permissão...) viram notificações.
        // Coleções do workspace que não existem neste computador (ex.: workspace compartilhado via Git).
        effect(() => {
            for (const { path, error } of this.workspaces.failed()) {
                this.messages.add({ severity: 'warn', summary: 'Collection not available', detail: `${path}: ${error}`, life: 8000 });
            }
        });

        effect(() => {
            const error = this.collections.error();

            if (error) {
                this.messages.add({ severity: 'error', summary: 'Collection error', detail: error, life: 6000 });
                this.collections.clearError();
            }
        });
    }

    /** Atalhos do próprio renderer (os do menu nativo chegam como `menu:action`). */
    protected onKeydown(event: KeyboardEvent): void {
        const mod = event.ctrlKey || event.metaKey;
        const visible = this.tabs.visibleTabs();
        const index = visible.findIndex((tab) => tab.id === this.tabs.activeId());

        if (mod && event.key.toLowerCase() === 's') {
            // O acelerador do menu nativo também dispara `save`; salvar duas vezes não tem efeito.
            event.preventDefault();
            void this.saveActive();
        } else if (mod && event.key.toLowerCase() === 'w' && index >= 0) {
            event.preventDefault();
            this.tabs.close(visible[index]!.id);
        } else if (event.ctrlKey && event.key === 'Tab' && visible.length > 1) {
            event.preventDefault();
            this.tabs.activate(visible[(index + (event.shiftKey ? -1 : 1) + visible.length) % visible.length]!.id);
        }
    }

    private async saveActive(): Promise<void> {
        try {
            await this.drafts.saveTab(this.tabs.active());
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not save the request', detail: error instanceof Error ? error.message : String(error), life: 6000 });
        }
    }

    private onMenuAction(action: MenuAction): void {
        switch (action.type) {
            case 'toggle-theme':
                void this.theme.toggle();
                break;
            case 'open-settings':
                void this.settingsDialog.open();
                break;
            case 'import-collection':
                this.ui.importCollectionDialog.set(true);
                break;
            case 'new-collection':
                this.ui.newCollectionDialog.set(true);
                break;
            case 'new-request': {
                const collectionId = this.tabs.context() ?? this.collections.opened()[0]?.metadata.id;

                if (collectionId) {
                    this.ui.newRequestDialog.set({ collectionId, folder: '' });
                } else {
                    this.messages.add({ severity: 'info', summary: 'Open a collection first', detail: 'Requests are saved inside a collection folder.' });
                }

                break;
            }
            case 'save':
                void this.saveActive();
                break;
        }
    }
}
