import { Component, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { ConfirmState } from '../core/state/confirm.state';

/** Renderiza a confirmação pendente do `ConfirmState`. */
@Component({
    selector: 'app-confirm-host',
    imports: [DialogModule, ButtonModule],
    template: `
        @if (confirm.pending(); as request) {
            <p-dialog closeAriaLabel="Close" [header]="request.header" [modal]="true" [visible]="true" (visibleChange)="!$event && confirm.answer(false)" [style]="{ width: '28rem' }" [draggable]="false" appendTo="body">
                <p class="m-0 text-sm">{{ request.message }}</p>
                <ng-template #footer>
                    <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="confirm.answer(false)" />
                    @if (request.alternativeLabel; as alternative) {
                        <p-button [label]="alternative" severity="secondary" [outlined]="true" (onClick)="confirm.answer('alternative')" />
                    }
                    <p-button [label]="request.acceptLabel" [severity]="request.severity ?? 'primary'" [autofocus]="true" (onClick)="confirm.answer(true)" />
                </ng-template>
            </p-dialog>
        }
    `
})
export class ConfirmHost {
    protected readonly confirm = inject(ConfirmState);
}
