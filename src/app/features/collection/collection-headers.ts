import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import type { EntityId, KeyValue } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { CollectionsState } from '../../core/state/collections.state';
import { KeyValueEditor } from '../request/key-value-editor';

/**
 * Headers base da coleção (gravados no `otto.yaml`): enviados em todas as requisições.
 * Quando a requisição define o mesmo header, o valor dela prevalece.
 */
@Component({
    selector: 'app-collection-headers',
    imports: [ButtonModule, MessageModule, KeyValueEditor],
    template: `
        <p class="m-0 mb-3 max-w-3xl text-sm text-muted-color">
            Sent with every request in this collection. A request that defines the same header (case-insensitive) overrides it — for example, set <code>Content-Type: application/json</code> here and use another type in an upload request. Values
            accept <code>{{ example }}</code
            >.
        </p>
        <app-key-value-editor [items]="draft()" (itemsChange)="draft.set($event)" label="Collection headers" addLabel="Add Header" />
        @if (error(); as message) {
            <p-message severity="error" styleClass="mt-3"
                ><span role="alert">{{ message }}</span></p-message
            >
        }
        <div class="mt-3 flex items-center gap-2">
            <p-button label="Save" icon="pi pi-check" size="small" [disabled]="!dirty()" [loading]="saving()" (onClick)="save()" />
            <p-button label="Discard Changes" size="small" severity="secondary" [text]="true" [disabled]="!dirty()" (onClick)="draft.set(saved())" />
            @if (dirty()) {
                <span class="text-xs text-muted-color" role="status">Unsaved changes</span>
            }
        </div>
    `,
    host: { class: 'block' }
})
export class CollectionHeaders {
    readonly collectionId = input.required<EntityId>();

    private readonly collections = inject(CollectionsState);

    protected readonly example = '{{token}}';
    protected readonly saved = computed<KeyValue[]>(() => this.collections.find(this.collectionId())?.manifest.headers ?? []);
    /** Edição local; volta ao salvo quando o arquivo muda (Save, Git, editor externo). */
    protected readonly draft = linkedSignal(() => this.saved());
    protected readonly dirty = computed(() => JSON.stringify(this.draft()) !== JSON.stringify(this.saved()));
    protected readonly saving = signal(false);
    protected readonly error = signal<string | null>(null);

    protected async save(): Promise<void> {
        this.saving.set(true);
        this.error.set(null);

        try {
            // Linhas totalmente vazias são descartadas.
            await this.collections.updateManifest(this.collectionId(), { headers: this.draft().filter((header) => header.key.trim() || header.value) });
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        } finally {
            this.saving.set(false);
        }
    }
}
