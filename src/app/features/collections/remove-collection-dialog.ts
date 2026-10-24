import { Component, effect, inject, untracked } from '@angular/core';
import { MessageService } from 'primeng/api';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { CollectionsState } from '../../core/state/collections.state';
import { ConfirmState } from '../../core/state/confirm.state';
import { TabsState } from '../../core/state/tabs.state';
import { UiState } from '../../core/state/ui.state';

/**
 * Confirma a remoção de uma coleção do workspace ativo (pedida via `UiState.removeCollectionDialog`)
 * usando a confirmação global. A ação alternativa também envia a pasta para a lixeira do sistema.
 */
@Component({
    selector: 'app-remove-collection-dialog',
    template: ''
})
export class RemoveCollectionDialog {
    private readonly ui = inject(UiState);
    private readonly collections = inject(CollectionsState);
    private readonly tabs = inject(TabsState);
    private readonly confirm = inject(ConfirmState);
    private readonly messages = inject(MessageService);

    constructor() {
        effect(() => {
            const id = this.ui.removeCollectionDialog();

            if (id) {
                untracked(() => void this.run(id));
            }
        });
    }

    private async run(id: string): Promise<void> {
        const collection = this.collections.find(id);
        this.ui.removeCollectionDialog.set(null);

        if (!collection) {
            return;
        }

        const answer = await this.confirm.choose({
            header: 'Remove Collection',
            message: `Remove the collection "${collection.metadata.name}" from this workspace?`,
            detail: `"Remove and Delete Files" also moves the folder ${collection.metadata.path} to the trash.`,
            acceptLabel: 'Remove',
            acceptIcon: 'pi pi-times',
            alternativeLabel: 'Remove and Delete Files',
            severity: 'danger'
        });

        if (answer === 'cancel') {
            return;
        }

        try {
            this.tabs.closeCollection(id);
            await (answer === 'alternative' ? this.collections.trash(id) : this.collections.close(id));
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not remove the collection', detail: ipcErrorMessage(error), life: 6000 });
        }
    }
}
