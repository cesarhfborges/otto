import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { UiState } from '../../core/state/ui.state';
import { WorkspacesState } from '../../core/state/workspaces.state';
import { EnterSubmit } from '../../shared/enter-submit.directive';

/** Cria `<pasta base>/<slug do nome>` com `workspace.yaml` e `collections/`, e ativa o workspace. */
@Component({
    selector: 'app-new-workspace-dialog',
    imports: [DialogModule, ReactiveFormsModule, EnterSubmit, InputTextModule, ButtonModule, MessageModule],
    template: `
        <p-dialog closeAriaLabel="Close" header="New Workspace" [modal]="true" [visible]="ui.newWorkspaceDialog()" (visibleChange)="!$event && close()" [style]="{ width: '32rem' }" [draggable]="false" appendTo="body">
            <form [formGroup]="form" appEnterSubmit (ngSubmit)="submit()" class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                    <label for="workspace-name" class="font-medium">Name</label>
                    <input pInputText id="workspace-name" formControlName="name" autocomplete="off" placeholder="My Team" aria-describedby="workspace-name-help" [attr.aria-invalid]="form.controls.name.invalid && form.controls.name.touched" />
                    <small id="workspace-name-help" class="text-muted-color">Created in the base folder set in Preferences → General, with a <code>collections</code> folder inside.</small>
                </div>
                @if (error(); as message) {
                    <p-message severity="error"
                        ><span role="alert">{{ message }}</span></p-message
                    >
                }
            </form>
            <ng-template #footer>
                <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="close()" />
                <p-button label="Create" icon="pi pi-check" [loading]="busy()" [disabled]="form.invalid" (onClick)="submit()" />
            </ng-template>
        </p-dialog>
    `
})
export class NewWorkspaceDialog {
    protected readonly ui = inject(UiState);
    private readonly workspaces = inject(WorkspacesState);

    protected readonly busy = signal(false);
    protected readonly error = signal<string | null>(null);
    protected readonly form = inject(FormBuilder).nonNullable.group({
        name: ['', [Validators.required, Validators.maxLength(120), Validators.pattern(/^[^./\\][^/\\]*$/)]]
    });

    protected async submit(): Promise<void> {
        if (this.form.invalid || this.busy()) {
            this.form.markAllAsTouched();

            return;
        }

        const { name } = this.form.getRawValue();

        this.busy.set(true);
        this.error.set(null);

        try {
            await this.workspaces.create(name.trim());
            this.close();
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        } finally {
            this.busy.set(false);
        }
    }

    protected close(): void {
        this.ui.newWorkspaceDialog.set(false);
        this.form.reset();
        this.error.set(null);
    }
}
