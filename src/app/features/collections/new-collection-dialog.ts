import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { CollectionsState } from '../../core/state/collections.state';
import { TabsState } from '../../core/state/tabs.state';
import { UiState } from '../../core/state/ui.state';
import { EnterSubmit } from '../../shared/enter-submit.directive';

/** Cria `<workspace>/collections/<slug do nome>` com o `otto.yaml` e abre a coleção. */
@Component({
    selector: 'app-new-collection-dialog',
    imports: [DialogModule, ReactiveFormsModule, EnterSubmit, InputTextModule, ButtonModule, MessageModule],
    template: `
        <p-dialog closeAriaLabel="Close" header="Create Collection" [modal]="true" [visible]="ui.newCollectionDialog()" (visibleChange)="!$event && close()" [style]="{ width: '32rem' }" [draggable]="false" appendTo="body">
            <form [formGroup]="form" appEnterSubmit (ngSubmit)="submit()" class="flex flex-col gap-4" id="new-collection-form">
                <div class="flex flex-col gap-2">
                    <label for="collection-name" class="font-medium">Name</label>
                    <input pInputText id="collection-name" formControlName="name" autocomplete="off" placeholder="My API" aria-describedby="collection-name-help" [attr.aria-invalid]="form.controls.name.invalid && form.controls.name.touched" />
                    <small id="collection-name-help" class="text-muted-color">Created in the <code>collections</code> folder of the current workspace.</small>
                </div>
                @if (error(); as message) {
                    <p-message severity="error"
                        ><span role="alert">{{ message }}</span></p-message
                    >
                }
            </form>
            <ng-template #footer>
                <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="close()" />
                <p-button label="Create" (onClick)="submit()" icon="pi pi-check" [loading]="busy()" [disabled]="form.invalid" />
            </ng-template>
        </p-dialog>
    `
})
export class NewCollectionDialog {
    protected readonly ui = inject(UiState);
    private readonly collections = inject(CollectionsState);
    private readonly tabs = inject(TabsState);

    protected readonly busy = signal(false);
    protected readonly error = signal<string | null>(null);
    protected readonly form = inject(FormBuilder).nonNullable.group({
        name: ['', [Validators.required, Validators.maxLength(120), Validators.pattern(/^[^./\\].*$/)]]
    });

    protected async submit(): Promise<void> {
        if (this.form.invalid || this.busy()) {
            return;
        }

        this.busy.set(true);
        this.error.set(null);

        const { name } = this.form.getRawValue();

        try {
            const created = await this.collections.create(name.trim());

            this.tabs.open({ kind: 'collection', title: 'Overview', collectionId: created.metadata.id });
            this.close();
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        } finally {
            this.busy.set(false);
        }
    }

    protected close(): void {
        this.ui.newCollectionDialog.set(false);
        this.form.reset();
        this.error.set(null);
    }
}
