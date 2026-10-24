import { Component, computed, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import type { ConfirmAnswer, ConfirmRequest, ConfirmSeverity } from '../../core/state/confirm.state';

const SEVERITY_ICON: Record<ConfirmSeverity, string> = {
    danger: 'pi pi-trash',
    warn: 'pi pi-exclamation-triangle',
    primary: 'pi pi-question-circle'
};

const SEVERITY_TONE: Record<ConfirmSeverity, string> = {
    danger: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
    warn: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    primary: 'bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300'
};

/** Conteúdo da modal de confirmação global, aberta pelo `ConfirmState` via DynamicDialog. */
@Component({
    selector: 'app-confirm-dialog',
    imports: [ButtonModule],
    template: `
        <div class="flex items-start gap-4">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full {{ tone() }}" aria-hidden="true">
                <i class="{{ icon() }} text-lg"></i>
            </span>
            <div class="flex min-w-0 flex-col gap-1 pt-1">
                <p id="confirm-dialog-message" class="m-0 whitespace-pre-line break-words text-sm">{{ request.message }}</p>
                @if (request.detail) {
                    <p class="m-0 text-xs text-muted-color">{{ request.detail }}</p>
                }
            </div>
        </div>
        <div class="mt-6 flex flex-wrap justify-end gap-2">
            <p-button [label]="request.rejectLabel ?? 'Cancel'" severity="secondary" [text]="true" (onClick)="close('cancel')" />
            @if (request.alternativeLabel; as alternative) {
                <p-button [label]="alternative" severity="secondary" [outlined]="true" (onClick)="close('alternative')" />
            }
            <p-button [label]="request.acceptLabel" [icon]="request.acceptIcon ?? ''" [severity]="buttonSeverity()" [autofocus]="true" (onClick)="close('accept')" />
        </div>
    `
})
export class ConfirmDialog {
    private readonly ref = inject<DynamicDialogRef<ConfirmDialog>>(DynamicDialogRef);
    protected readonly request = inject<DynamicDialogConfig<ConfirmRequest>>(DynamicDialogConfig).data!;

    private readonly severity = (): ConfirmSeverity => this.request.severity ?? 'primary';
    protected readonly icon = computed(() => this.request.icon ?? SEVERITY_ICON[this.severity()]);
    protected readonly tone = computed(() => SEVERITY_TONE[this.severity()]);
    protected readonly buttonSeverity = computed(() => (this.severity() === 'warn' ? 'warn' : this.severity()));

    protected close(answer: ConfirmAnswer): void {
        this.ref.close(answer);
    }
}
