import { Component, DestroyRef, effect, inject } from '@angular/core';
import type { MenuAction } from '@shared/models';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { MenuEventsGateway } from '../core/ports';
import { CollectionsState } from '../core/state/collections.state';
import { TabsState } from '../core/state/tabs.state';
import { UiState } from '../core/state/ui.state';
import { WorkspacesState } from '../core/state/workspaces.state';
import { ThemeService } from '../core/theme/theme.service';
import { CollectionsSidebar } from '../features/collections/collections-sidebar';
import { NewCollectionDialog } from '../features/collections/new-collection-dialog';
import { NewFolderDialog } from '../features/collections/new-folder-dialog';
import { NewRequestDialog } from '../features/collections/new-request-dialog';
import { ImportCollectionDialog } from '../features/collections/import-collection-dialog';
import { ImportWorkspaceDialog } from '../features/workspace/import-workspace-dialog';
import { NewWorkspaceDialog } from '../features/workspace/new-workspace-dialog';
import { ConfirmHost } from './confirm-host';
import { ContextHeader } from './context-header';
import { StatusBar } from './status-bar';
import { TabHost } from './tab-host';
import { TabStrip } from './tab-strip';
import { TitleBar } from './title-bar';

/**
 * Layout principal (estilo Bruno): barra de título, coleções à esquerda e, à
 * direita, cabeçalho do contexto + abas + conteúdo; barra de status no rodapé.
 */
@Component({
    selector: 'app-shell',
    imports: [TitleBar, CollectionsSidebar, ContextHeader, TabStrip, TabHost, StatusBar, NewCollectionDialog, NewRequestDialog, NewFolderDialog, NewWorkspaceDialog, ImportWorkspaceDialog, ImportCollectionDialog, ConfirmHost, ToastModule],
    providers: [MessageService],
    template: `
        <app-title-bar />
        <div class="flex min-h-0 flex-1">
            @if (ui.sidebarVisible()) {
                <app-collections-sidebar class="w-72 shrink-0" />
            }
            <main class="flex min-w-0 flex-1 flex-col bg-surface-0 dark:bg-surface-950">
                <app-context-header />
                <app-tab-strip />
                <app-tab-host />
            </main>
        </div>
        <app-status-bar />

        <app-new-collection-dialog />
        <app-new-request-dialog />
        <app-new-folder-dialog />
        <app-new-workspace-dialog />
        <app-import-workspace-dialog />
        <app-import-collection-dialog />
        <p-toast position="bottom-right" />
        <app-confirm-host />
    `,
    host: {
        class: 'flex h-screen flex-col text-color',
        '(document:keydown)': 'onKeydown($event)'
    }
})
export class Shell {
    protected readonly ui = inject(UiState);
    private readonly tabs = inject(TabsState);
    private readonly collections = inject(CollectionsState);
    private readonly theme = inject(ThemeService);
    private readonly messages = inject(MessageService);
    private readonly workspaces = inject(WorkspacesState);

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

        if (mod && event.key.toLowerCase() === 'w' && index >= 0) {
            event.preventDefault();
            this.tabs.close(visible[index]!.id);
        } else if (event.ctrlKey && event.key === 'Tab' && visible.length > 1) {
            event.preventDefault();
            this.tabs.activate(visible[(index + (event.shiftKey ? -1 : 1) + visible.length) % visible.length]!.id);
        }
    }

    private onMenuAction(action: MenuAction): void {
        switch (action.type) {
            case 'toggle-theme':
                void this.theme.toggle();
                break;
            case 'open-settings':
                this.tabs.open({ kind: 'settings', title: 'Preferences', collectionId: null });
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
                // Edição de requisições chega com o editor (Etapa 7).
                break;
        }
    }
}
