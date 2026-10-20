import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { CollectionsState } from '../../core/state/collections.state';
import { TabsState } from '../../core/state/tabs.state';
import { UiState } from '../../core/state/ui.state';

/**
 * Confirma a remoção de uma coleção do workspace ativo e, opcionalmente,
 * envia a pasta dela para a lixeira do sistema (recuperável).
 */
@Component({
    selector: 'app-remove-collection-dialog',
    imports: [DialogModule, ReactiveFormsModule, CheckboxModule, ButtonModule, MessageModule],
    template: `
        <p-dialog closeAriaLabel="Close" header="Remove Collection" [modal]="true" [visible]="!!collection()" (visibleChange)="!$event && close()" [style]="{ width: '30rem' }" [draggable]="false" appendTo="body">
            @if (collection(); as current) {
                <div class="flex flex-col gap-4">
                    <p class="m-0 text-sm">
                        Remove the collection <strong>{{ current.metadata.name }}</strong> from this workspace?
                    </p>
                    <div class="flex items-start gap-2">
                        <p-checkbox inputId="remove-collection-trash" [formControl]="trashControl" [binary]="true" ariaDescribedBy="remove-collection-trash-help" />
                        <div class="flex min-w-0 flex-col gap-1">
                            <label for="remove-collection-trash" class="text-sm font-medium">Also delete the collection files</label>
                            <small id="remove-collection-trash-help" class="break-all text-muted-color">The folder <code>{{ current.metadata.path }}</code> will be moved to the trash.</small>
                        </div>
                    </div>
                    @if (error(); as message) {
                        <p-message severity="error"
                            ><span role="alert">{{ message }}</span></p-message
                        >
                    }
                </div>
            }
            <ng-template #footer>
                <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="close()" />
                <p-button [label]="trash() ? 'Remove and Delete' : 'Remove'" [icon]="trash() ? 'pi pi-trash' : 'pi pi-times'" severity="danger" [loading]="busy()" (onClick)="submit()" />
            </ng-template>
        </p-dialog>
    `
})
export class RemoveCollectionDialog {
    protected readonly ui = inject(UiState);
    private readonly collections = inject(CollectionsState);
    private readonly tabs = inject(TabsState);

    protected readonly collection = computed(() => this.collections.find(this.ui.removeCollectionDialog()));
    protected readonly trashControl = new FormControl(false, { nonNullable: true });
    protected readonly trash = signal(false);
    protected readonly busy = signal(false);
    protected readonly error = signal<string | null>(null);

    constructor() {
        this.trashControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => this.trash.set(value));

        // Cada abertura começa sem apagar arquivos (a opção destrutiva é sempre explícita).
        effect(() => {
            this.ui.removeCollectionDialog();
            this.trashControl.setValue(false);
            this.error.set(null);
        });
    }

    protected async submit(): Promise<void> {
        const id = this.ui.removeCollectionDialog();

        if (!id || this.busy()) {
            return;
        }

        this.busy.set(true);
        this.error.set(null);

        try {
            this.tabs.closeCollection(id);
            await (this.trash() ? this.collections.trash(id) : this.collections.close(id));
            this.close();
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        } finally {
            this.busy.set(false);
        }
    }

    protected close(): void {
        this.ui.removeCollectionDialog.set(null);
    }
}
