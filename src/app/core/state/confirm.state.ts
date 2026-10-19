import { Injectable, signal } from '@angular/core';

export interface ConfirmRequest {
    header: string;
    message: string;
    acceptLabel: string;
    /** `danger` para ações destrutivas (botão vermelho). */
    severity?: 'danger' | 'primary';
}

interface PendingConfirm extends ConfirmRequest {
    resolve(accepted: boolean): void;
}

/**
 * Confirmações modais baseadas em Promise. Substitui o ConfirmDialog do PrimeNG,
 * que mantém um `role="alertdialog"` sem nome no DOM mesmo fechado (falha no axe).
 */
@Injectable({ providedIn: 'root' })
export class ConfirmState {
    readonly pending = signal<PendingConfirm | null>(null);

    ask(request: ConfirmRequest): Promise<boolean> {
        this.pending()?.resolve(false);

        return new Promise((resolve) => this.pending.set({ ...request, resolve }));
    }

    answer(accepted: boolean): void {
        this.pending()?.resolve(accepted);
        this.pending.set(null);
    }
}
