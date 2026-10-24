import { inject, Injectable } from '@angular/core';
import { AppInfoGateway } from '../ports';
import { ConfirmState } from './confirm.state';
import { draftKey, RequestDraftsState } from './request-drafts.state';
import { TabsState } from './tabs.state';

/**
 * Responde aos pedidos de saída do app (File → Quit, Ctrl+Q, tray, fechar sem bandeja):
 * com requisições não salvas, pergunta antes de descartá-las. Fechar para a bandeja não passa aqui.
 */
@Injectable({ providedIn: 'root' })
export class QuitGuardState {
    private readonly app = inject(AppInfoGateway);
    private readonly confirm = inject(ConfirmState);
    private readonly drafts = inject(RequestDraftsState);
    private readonly tabs = inject(TabsState);
    private asking = false;

    constructor() {
        this.app.onQuitRequested(() => void this.handle());
    }

    private async handle(): Promise<void> {
        // Pedidos repetidos (Ctrl+Q de novo) enquanto o aviso está aberto são ignorados.
        if (this.asking) {
            return;
        }

        this.asking = true;

        try {
            if (await this.confirmDiscard()) {
                await this.app.confirmQuit();
            }
        } finally {
            this.asking = false;
        }
    }

    private async confirmDiscard(): Promise<boolean> {
        const dirty = this.drafts.dirtyKeys();

        if (!dirty.size) {
            return true;
        }

        const titles = this.tabs
            .tabs()
            .filter((tab) => tab.kind === 'request' && tab.collectionId && tab.resourceRef && dirty.has(draftKey(tab.collectionId, tab.resourceRef)))
            .map((tab) => `"${tab.title}"`);
        const message = titles.length === 1 ? `${titles[0]} has unsaved changes. Quit and discard them?` : `${titles.length || dirty.size} requests have unsaved changes${titles.length ? `: ${titles.join(', ')}` : ''}. Quit and discard them?`;

        return this.confirm.ask({ header: 'Unsaved Changes', message, acceptLabel: 'Discard and Quit', severity: 'warn' });
    }
}
