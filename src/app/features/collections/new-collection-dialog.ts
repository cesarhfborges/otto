import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { DialogGateway } from '../../core/ports';
import { CollectionsState } from '../../core/state/collections.state';
import { TabsState } from '../../core/state/tabs.state';
import { UiState } from '../../core/state/ui.state';

/** Cria `<local>/<slug do nome>` com o `otto.yaml` e abre a coleção. */
@Component({
    selector: 'app-new-collection-dialog',
    imports: [DialogModule, ReactiveFormsModule, InputTextModule, ButtonModule, MessageModule],
    template: `
        <p-dialog header="Create Collection" [modal]="true" [visible]="ui.newCollectionDialog()" (visibleChange)="!$event && close()" [style]="{ width: '32rem' }" [draggable]="false" appendTo="body">
            <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-4" id="new-collection-form">
                <div class="flex flex-col gap-2">
                    <label for="collection-name" class="font-medium">Name</label>
                    <input pInputText id="collection-name" formControlName="name" autocomplete="off" placeholder="My API" [attr.aria-invalid]="form.controls.name.invalid && form.controls.name.touched" />
                </div>
                <div class="flex flex-col gap-2">
                    <label for="collection-location" class="font-medium">Location</label>
                    <div class="flex gap-2">
                        <input pInputText id="collection-location" class="min-w-0 flex-1" formControlName="location" readonly placeholder="Choose a folder" aria-describedby="collection-location-help" />
                        <p-button type="button" label="Browse…" icon="pi pi-folder-open" severity="secondary" (onClick)="browse()" />
                    </div>
                    <small id="collection-location-help" class="text-muted-color">A new folder named after the collection is created here. It can be a Git repository.</small>
                </div>
                @if (error(); as message) {
                    <p-message severity="error"
                        ><span role="alert">{{ message }}</span></p-message
                    >
                }
            </form>
            <ng-template #footer>
                <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="close()" />
                <p-button type="submit" form="new-collection-form" label="Create" icon="pi pi-check" [loading]="busy()" [disabled]="form.invalid" />
            </ng-template>
        </p-dialog>
    `
})
export class NewCollectionDialog {
    protected readonly ui = inject(UiState);
    private readonly collections = inject(CollectionsState);
    private readonly tabs = inject(TabsState);
    private readonly dialogs = inject(DialogGateway);

    protected readonly busy = signal(false);
    protected readonly error = signal<string | null>(null);
    protected readonly form = inject(FormBuilder).nonNullable.group({
        name: ['', [Validators.required, Validators.maxLength(120), Validators.pattern(/^[^./\\].*$/)]],
        location: ['', Validators.required]
    });

    protected async browse(): Promise<void> {
        const folder = await this.dialogs.chooseCollectionLocation();

        if (folder) {
            this.form.controls.location.setValue(folder);
        }
    }

    protected async submit(): Promise<void> {
        if (this.form.invalid || this.busy()) {
            return;
        }

        this.busy.set(true);
        this.error.set(null);

        const { name, location } = this.form.getRawValue();
        const created = await this.collections.create(location, name.trim());

        this.busy.set(false);

        if (created) {
            this.tabs.open({ kind: 'collection', title: 'Overview', collectionId: created.metadata.id });
            this.close();
        } else {
            this.error.set(this.collections.error());
            this.collections.clearError();
        }
    }

    protected close(): void {
        this.ui.newCollectionDialog.set(false);
        this.form.reset();
        this.error.set(null);
    }
}
