import { Injectable, signal } from '@angular/core';

export interface ConfirmRequest {
    header: string;
    message: string;
    acceptLabel: string;
    /** `danger` para ações destrutivas (botão vermelho). */
    severity?: 'danger' | 'primary';
}

/** Confirmação com uma segunda ação além da principal (ex.: "Remover" ou "Recriar"). */
export interface ChoiceRequest extends ConfirmRequest {
    alternativeLabel: string;
}

export type ConfirmAnswer = 'accept' | 'alternative' | 'cancel';

interface PendingConfirm extends ConfirmRequest {
    alternativeLabel?: string;
    resolve(answer: ConfirmAnswer): void;
}

/**
 * Confirmações modais baseadas em Promise. Substitui o ConfirmDialog do PrimeNG,
 * que mantém um `role="alertdialog"` sem nome no DOM mesmo fechado (falha no axe).
 */
@Injectable({ providedIn: 'root' })
export class ConfirmState {
    readonly pending = signal<PendingConfirm | null>(null);

    async ask(request: ConfirmRequest): Promise<boolean> {
        return (await this.choose(request)) === 'accept';
    }

    /** Como `ask`, mas com a ação alternativa quando `alternativeLabel` é informado. */
    choose(request: ConfirmRequest | ChoiceRequest): Promise<ConfirmAnswer> {
        this.pending()?.resolve('cancel');

        return new Promise((resolve) => this.pending.set({ ...request, resolve }));
    }

    answer(answer: ConfirmAnswer | boolean): void {
        this.pending()?.resolve(answer === true ? 'accept' : answer === false ? 'cancel' : answer);
        this.pending.set(null);
    }
}
