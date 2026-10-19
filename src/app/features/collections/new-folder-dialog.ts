import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { CollectionFilesGateway } from '../../core/ports';
import { UiState } from '../../core/state/ui.state';

/** Cria uma pasta dentro da coleção (agrupamento de requisições). */
@Component({
    selector: 'app-new-folder-dialog',
    imports: [DialogModule, ReactiveFormsModule, InputTextModule, ButtonModule, MessageModule],
    template: `
        <p-dialog header="New Folder" [modal]="true" [visible]="!!ui.newFolderDialog()" (visibleChange)="!$event && close()" [style]="{ width: '28rem' }" [draggable]="false" appendTo="body">
            <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-4" id="new-folder-form">
                <div class="flex flex-col gap-2">
                    <label for="folder-name" class="font-medium">Name</label>
                    <input pInputText id="folder-name" formControlName="name" autocomplete="off" placeholder="users" aria-describedby="folder-name-help" />
                    <small id="folder-name-help" class="text-muted-color">Cannot contain "/" or "\\" or start with ".".</small>
                </div>
                @if (error(); as message) {
                    <p-message severity="error"
                        ><span role="alert">{{ message }}</span></p-message
                    >
                }
            </form>
            <ng-template #footer>
                <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="close()" />
                <p-button type="submit" form="new-folder-form" label="Create" icon="pi pi-check" [loading]="busy()" [disabled]="form.invalid" />
            </ng-template>
        </p-dialog>
    `
})
export class NewFolderDialog {
    protected readonly ui = inject(UiState);
    private readonly files = inject(CollectionFilesGateway);

    protected readonly busy = signal(false);
    protected readonly error = signal<string | null>(null);
    protected readonly form = inject(FormBuilder).nonNullable.group({
        name: ['', [Validators.required, Validators.maxLength(120), Validators.pattern(/^[^./\\][^/\\]*$/)]]
    });

    protected async submit(): Promise<void> {
        const target = this.ui.newFolderDialog();

        if (!target || this.form.invalid || this.busy()) {
            return;
        }

        this.busy.set(true);
        this.error.set(null);

        try {
            await this.files.createFolder(target.collectionId, target.folder, this.form.getRawValue().name.trim());
            this.close();
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        } finally {
            this.busy.set(false);
        }
    }

    protected close(): void {
        this.ui.newFolderDialog.set(null);
        this.form.reset();
        this.error.set(null);
    }
}
