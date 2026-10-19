import { Component, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { DialogGateway } from '../../core/ports';
import { CollectionsState } from '../../core/state/collections.state';
import { TabsState } from '../../core/state/tabs.state';
import { UiState } from '../../core/state/ui.state';

/**
 * Traz uma coleção para o workspace ativo copiando-a para `<workspace>/collections`:
 * de um .zip exportado pelo Otto ou de uma pasta com `otto.yaml`. A origem não é alterada.
 */
@Component({
    selector: 'app-import-collection-dialog',
    imports: [DialogModule, InputTextModule, ButtonModule, MessageModule],
    template: `
        <p-dialog closeAriaLabel="Close" header="Import Collection" [modal]="true" [visible]="ui.importCollectionDialog()" (visibleChange)="!$event && close()" [style]="{ width: '34rem' }" [draggable]="false" appendTo="body">
            <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                    <label for="import-collection-source" class="font-medium">Source</label>
                    <input pInputText id="import-collection-source" [value]="source() ?? ''" readonly placeholder="Choose a .zip file or a collection folder" aria-describedby="import-collection-help" />
                    <div class="flex flex-wrap gap-2">
                        <p-button label="Choose .zip…" icon="pi pi-file" severity="secondary" size="small" (onClick)="browseArchive()" />
                        <p-button label="Choose Folder…" icon="pi pi-folder-open" severity="secondary" size="small" (onClick)="browseFolder()" />
                    </div>
                    <small id="import-collection-help" class="text-muted-color">The collection is copied into the <code>collections</code> folder of the current workspace. The original is not changed.</small>
                </div>
                @if (error(); as message) {
                    <p-message severity="error"
                        ><span role="alert">{{ message }}</span></p-message
                    >
                }
            </div>
            <ng-template #footer>
                <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="close()" />
                <p-button label="Import" icon="pi pi-download" [loading]="busy()" [disabled]="!source()" (onClick)="submit()" />
            </ng-template>
        </p-dialog>
    `
})
export class ImportCollectionDialog {
    protected readonly ui = inject(UiState);
    private readonly collections = inject(CollectionsState);
    private readonly tabs = inject(TabsState);
    private readonly dialogs = inject(DialogGateway);

    protected readonly source = signal<string | null>(null);
    protected readonly busy = signal(false);
    protected readonly error = signal<string | null>(null);

    protected async browseArchive(): Promise<void> {
        this.pick(await this.dialogs.pickCollectionArchive());
    }

    protected async browseFolder(): Promise<void> {
        this.pick(await this.dialogs.pickCollectionFolder());
    }

    protected async submit(): Promise<void> {
        const source = this.source();

        if (!source || this.busy()) {
            return;
        }

        this.busy.set(true);
        this.error.set(null);

        try {
            const imported = await this.collections.import(source);

            this.tabs.open({ kind: 'collection', title: 'Overview', collectionId: imported.metadata.id });
            this.close();
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        } finally {
            this.busy.set(false);
        }
    }

    protected close(): void {
        this.ui.importCollectionDialog.set(false);
        this.source.set(null);
        this.error.set(null);
    }

    private pick(source: string | null): void {
        if (source) {
            this.source.set(source);
            this.error.set(null);
        }
    }
}
