import { inject, Injectable } from '@angular/core';
import { DialogService, type DynamicDialogRef } from 'primeng/dynamicdialog';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialog } from '../../shared/confirm-dialog/confirm-dialog';

export type ConfirmSeverity = 'danger' | 'warn' | 'primary';

export interface ConfirmRequest {
    header: string;
    message: string;
    acceptLabel: string;
    /** Texto secundário, menor, abaixo da mensagem (ex.: "This can't be undone."). */
    detail?: string;
    rejectLabel?: string;
    acceptIcon?: string;
    /** Ícone do cabeçalho; por padrão depende da `severity`. */
    icon?: string;
    /** `danger` para ações destrutivas (botão e ícone vermelhos). */
    severity?: ConfirmSeverity;
    /** Ação alternativa além da principal (ex.: "Remover" ou "Recriar"). */
    alternativeLabel?: string;
}

/** Confirmação com uma segunda ação além da principal. */
export interface ChoiceRequest extends ConfirmRequest {
    alternativeLabel: string;
}

export type ConfirmAnswer = 'accept' | 'alternative' | 'cancel';

/**
 * Confirmações modais baseadas em Promise, renderizadas pelo `ConfirmDialog` via DynamicDialog.
 * Só existe uma confirmação aberta por vez: uma nova cancela a anterior.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmState {
    private readonly dialogs = inject(DialogService);
    private ref: DynamicDialogRef<ConfirmDialog> | null = null;

    async ask(request: ConfirmRequest): Promise<boolean> {
        return (await this.choose(request)) === 'accept';
    }

    /** Atalho para exclusões: severidade `danger`, ícone de lixeira e aviso de que não dá para desfazer. */
    askDelete(request: Pick<ConfirmRequest, 'header' | 'message'> & Partial<ConfirmRequest>): Promise<boolean> {
        return this.ask({ acceptLabel: 'Delete', acceptIcon: 'pi pi-trash', detail: 'This action cannot be undone.', severity: 'danger', ...request });
    }

    /** Como `ask`, mas com a ação alternativa quando `alternativeLabel` é informado. */
    async choose(request: ConfirmRequest | ChoiceRequest): Promise<ConfirmAnswer> {
        this.ref?.close('cancel');

        const ref = this.dialogs.open<ConfirmDialog, ConfirmRequest>(ConfirmDialog, {
            header: request.header,
            data: request,
            modal: true,
            closable: true,
            closeOnEscape: true,
            dismissableMask: true,
            draggable: false,
            resizable: false,
            focusTrap: true,
            closeAriaLabel: 'Close',
            appendTo: 'body',
            style: { width: '30rem' },
            breakpoints: { '640px': '92vw' }
        });

        if (!ref) {
            return 'cancel';
        }

        this.ref = ref;
        const answer = (await firstValueFrom(ref.onClose)) as ConfirmAnswer | undefined;

        if (this.ref === ref) {
            this.ref = null;
        }

        return answer ?? 'cancel';
    }
}
