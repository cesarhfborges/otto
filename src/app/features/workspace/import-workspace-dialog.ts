import { Component, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { DialogGateway } from '../../core/ports';
import { UiState } from '../../core/state/ui.state';
import { WorkspacesState } from '../../core/state/workspaces.state';

/** Extrai um .zip exportado pelo Otto na pasta base e ativa o workspace. */
@Component({
    selector: 'app-import-workspace-dialog',
    imports: [DialogModule, InputTextModule, ButtonModule, MessageModule],
    template: `
        <p-dialog closeAriaLabel="Close" header="Import Workspace" [modal]="true" [visible]="ui.importWorkspaceDialog()" (visibleChange)="!$event && close()" [style]="{ width: '34rem' }" [draggable]="false" appendTo="body">
            <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                    <label for="import-file" class="font-medium">Workspace file</label>
                    <div class="flex gap-2">
                        <input pInputText id="import-file" class="min-w-0 flex-1" [value]="file() ?? ''" readonly placeholder="Choose a .zip file" aria-describedby="import-file-help" />
                        <p-button label="Browse…" icon="pi pi-file" severity="secondary" (onClick)="browse()" />
                    </div>
                    <small id="import-file-help" class="text-muted-color">A .zip created with Export in Manage Workspaces. It is extracted into the base folder set in Preferences → General.</small>
                </div>
                @if (error(); as message) {
                    <p-message severity="error"
                        ><span role="alert">{{ message }}</span></p-message
                    >
                }
            </div>
            <ng-template #footer>
                <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="close()" />
                <p-button label="Import" icon="pi pi-download" [loading]="busy()" [disabled]="!file()" (onClick)="submit()" />
            </ng-template>
        </p-dialog>
    `
})
export class ImportWorkspaceDialog {
    protected readonly ui = inject(UiState);
    private readonly workspaces = inject(WorkspacesState);
    private readonly dialogs = inject(DialogGateway);

    protected readonly file = signal<string | null>(null);
    protected readonly busy = signal(false);
    protected readonly error = signal<string | null>(null);

    protected async browse(): Promise<void> {
        const file = await this.dialogs.pickWorkspaceArchive();

        if (file) {
            this.file.set(file);
        }
    }

    protected async submit(): Promise<void> {
        const file = this.file();

        if (!file || this.busy()) {
            return;
        }

        this.busy.set(true);
        this.error.set(null);

        try {
            await this.workspaces.import(file);
            this.close();
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        } finally {
            this.busy.set(false);
        }
    }

    protected close(): void {
        this.ui.importWorkspaceDialog.set(false);
        this.file.set(null);
        this.error.set(null);
    }
}
