import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { ipcErrorMessage } from '../core/bridge/ipc-error';
import { registerAppCommands } from '../core/keyboard/app-commands';
import { CollectionsState } from '../core/state/collections.state';
import { UiState } from '../core/state/ui.state';
import { WorkspacesState } from '../core/state/workspaces.state';
import { RequestDraftsState } from '../core/state/request-drafts.state';
import { CollectionsSidebar } from '../features/collections/collections-sidebar';
import { NewCollectionDialog } from '../features/collections/new-collection-dialog';
import { NewFolderDialog } from '../features/collections/new-folder-dialog';
import { NewRequestDialog } from '../features/collections/new-request-dialog';
import { ImportCollectionDialog } from '../features/collections/import-collection-dialog';
import { RemoveCollectionDialog } from '../features/collections/remove-collection-dialog';
import { ImportWorkspaceDialog } from '../features/workspace/import-workspace-dialog';
import { NewWorkspaceDialog } from '../features/workspace/new-workspace-dialog';
import { ShortcutsDialog } from '../features/settings/shortcuts-dialog';
import { CommandPalette } from '../features/palette/command-palette';
import { ResponseRefDialog } from '../features/request/response-ref-dialog';
import { ResponseRefBuilderState } from '../core/state/response-ref-builder.state';
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
        CommandPalette,
        ResponseRefDialog,
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
        ShortcutsDialog,
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
        <app-shortcuts-dialog />
        @defer (when ui.commandPalette()) {
            <app-command-palette />
        }
        @defer (when refBuilder.pending()) {
            <app-response-ref-dialog />
        }
        <p-toast position="top-right" />
    `,
    host: {
        class: 'flex h-screen flex-col text-color'
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
    protected readonly refBuilder = inject(ResponseRefBuilderState);

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

    private readonly collections = inject(CollectionsState);
    private readonly messages = inject(MessageService);
    private readonly workspaces = inject(WorkspacesState);

    constructor() {
        // Também registra a confirmação ao fechar abas com alterações não salvas.
        inject(RequestDraftsState);
        void this.workspaces.load();

        // Atalhos de teclado, menu nativo e tray (ver `core/keyboard`).
        registerAppCommands();

        // Falhas de abrir/criar coleções (pasta inválida, sem permissão...) viram notificações.
        // Coleções do workspace que não existem neste computador (ex.: workspace compartilhado via Git).
        effect(() => {
            for (const { path, error } of this.workspaces.failed()) {
                this.messages.add({ severity: 'warn', summary: 'Collection not available', detail: `${path}: ${error}`, life: 8000 });
            }
        });

        // Pasta do workspace ativo apagada/movida: pergunta se remove da lista ou recria.
        effect(() => {
            const missing = this.workspaces.missingActive();

            if (missing) {
                untracked(() => void this.workspaces.resolveMissing(missing).catch((error: unknown) => this.messages.add({ severity: 'error', summary: 'Could not fix the workspace', detail: ipcErrorMessage(error), life: 6000 })));
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
}
