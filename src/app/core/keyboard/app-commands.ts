import { DestroyRef, inject } from '@angular/core';
import type { CommandId } from '@shared/models';
import { MessageService } from 'primeng/api';
import { SettingsDialog } from '../../features/settings/settings-dialog.service';
import { MenuEventsGateway } from '../ports';
import { CollectionsState } from '../state/collections.state';
import { RequestDraftsState } from '../state/request-drafts.state';
import { SettingsState } from '../state/settings.state';
import { TabsState } from '../state/tabs.state';
import { UiState } from '../state/ui.state';
import { ThemeService } from '../theme/theme.service';
import { registerCommand } from './command-registry';
import { KeybindingService } from './keybinding.service';

/**
 * Comandos globais (abas, diálogos, tema, barra lateral...) e o encaminhamento do
 * menu nativo/tray. Chamado pelo `Shell`, que fornece o `MessageService` dos avisos.
 * Comandos que dependem de uma tela (enviar requisição, renomear na árvore...) são
 * registrados pela própria tela.
 */
export function registerAppCommands(): void {
    const tabs = inject(TabsState);
    const ui = inject(UiState);
    const collections = inject(CollectionsState);
    const drafts = inject(RequestDraftsState);
    const settings = inject(SettingsState);
    const theme = inject(ThemeService);
    const settingsDialog = inject(SettingsDialog);
    const messages = inject(MessageService);
    const keyboard = inject(KeybindingService);

    const visible = () => tabs.visibleTabs();
    const activeIndex = () => visible().findIndex((tab) => tab.id === tabs.activeId());
    const fail = (summary: string) => (error: unknown) => messages.add({ severity: 'error', summary, detail: error instanceof Error ? error.message : String(error), life: 6000 });

    // Menu nativo e tray executam os mesmos comandos dos atalhos.
    inject(DestroyRef).onDestroy(inject(MenuEventsGateway).onMenuAction((action) => keyboard.runFromMenu(action.id)));

    registerCommand('app.preferences', { run: () => settingsDialog.open() });
    registerCommand('app.shortcuts', { run: () => ui.shortcutsDialog.set(true) });
    registerCommand('app.keyboardShortcutsSettings', { run: () => settingsDialog.open('shortcuts') });
    registerCommand('theme.cycle', { run: () => theme.toggle() });
    registerCommand('view.toggleSidebar', { run: () => ui.toggleSidebar() });
    registerCommand('view.toggleRequestLayout', {
        run: () => {
            const layout = settings.settings().appearance.requestLayout === 'horizontal' ? 'vertical' : 'horizontal';

            return settings.update({ appearance: { requestLayout: layout } }).catch(fail('Could not change the layout'));
        }
    });

    registerCommand('tabs.close', { when: () => activeIndex() >= 0, run: () => tabs.close(tabs.activeId()!) });
    registerCommand('tabs.closeOthers', { when: () => visible().length > 1, run: () => tabs.closeOthers(tabs.activeId()!) });
    registerCommand('tabs.closeAll', { when: () => visible().length > 0, run: () => tabs.closeAll() });
    registerCommand('tabs.reopenClosed', { when: () => tabs.canReopen(), run: () => tabs.reopenClosed() });

    const cycle = (step: -1 | 1) => () => {
        const list = visible();

        tabs.activate(list[(activeIndex() + step + list.length) % list.length]!.id);
    };

    registerCommand('tabs.next', { when: () => visible().length > 1, run: cycle(1) });
    registerCommand('tabs.previous', { when: () => visible().length > 1, run: cycle(-1) });

    for (const n of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
        registerCommand(`tabs.goTo${n}` satisfies CommandId, { when: () => visible().length >= n, run: () => tabs.activate(visible()[n - 1]!.id) });
    }

    registerCommand('tabs.goToLast', { when: () => visible().length > 0, run: () => tabs.activate(visible().at(-1)!.id) });
    registerCommand('tabs.moveLeft', { when: () => activeIndex() > 0, run: () => tabs.move(tabs.activeId()!, -1) });
    registerCommand('tabs.moveRight', { when: () => activeIndex() >= 0 && activeIndex() < visible().length - 1, run: () => tabs.move(tabs.activeId()!, 1) });

    registerCommand('request.save', {
        when: () => {
            const tab = tabs.active();

            return tab?.kind === 'request' && !!tab.collectionId && !!tab.resourceRef;
        },
        run: () => drafts.saveTab(tabs.active()).catch(fail('Could not save the request'))
    });
    registerCommand('request.saveAll', { when: () => drafts.anyDirty(), run: () => drafts.saveAll().catch(fail('Could not save all requests')) });

    // Ctrl+Enter num formulário (diálogos, ambientes...): envia como o botão principal, inclusive de um textarea.
    registerCommand('form.submit', { when: ({ form }) => !!form, run: ({ form }) => form?.requestSubmit() });

    registerCommand('collection.newRequest', {
        run: () => {
            const collectionId = tabs.context() ?? collections.opened()[0]?.metadata.id;

            if (collectionId) {
                ui.newRequestDialog.set({ collectionId, folder: '' });
            } else {
                messages.add({ severity: 'info', summary: 'Open a collection first', detail: 'Requests are saved inside a collection folder.' });
            }
        }
    });
    registerCommand('collection.newFolder', { when: () => !!tabs.context(), run: () => ui.newFolderDialog.set({ collectionId: tabs.context()!, folder: '' }) });
    registerCommand('collection.new', { run: () => ui.newCollectionDialog.set(true) });
    registerCommand('collection.import', { run: () => ui.importCollectionDialog.set(true) });
    registerCommand('collection.overview', { when: () => !!tabs.context(), run: () => tabs.open({ kind: 'collection', title: 'Overview', collectionId: tabs.context() }) });

    const focusSidebar = (filter: boolean) => () => {
        ui.sidebarVisible.set(true);
        ui.sidebarFocusRequest.set({ filter });
    };

    registerCommand('sidebar.focus', { run: focusSidebar(false) });
    registerCommand('sidebar.filter', { when: () => collections.opened().length > 0, run: focusSidebar(true) });

    registerCommand('environment.manage', { when: () => !!tabs.context(), run: () => tabs.open({ kind: 'environments', title: 'Environments', collectionId: tabs.context() }) });
    registerCommand('workspace.manage', { run: () => tabs.open({ kind: 'workspaces', title: 'Workspaces', collectionId: null }) });
}
