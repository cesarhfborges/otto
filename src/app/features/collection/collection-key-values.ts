import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import type { EntityId, KeyValue } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { CollectionsState } from '../../core/state/collections.state';
import { TemplateScope } from '../../core/templating/template-scope';
import { KeyValueEditor } from '../request/key-value-editor';

/**
 * Lista de pares do `otto.yaml` (headers ou variáveis da coleção), com Save/Discard.
 * A explicação de cada lista vem pelo conteúdo projetado.
 */
@Component({
    selector: 'app-collection-key-values',
    imports: [ButtonModule, MessageModule, KeyValueEditor],
    providers: [TemplateScope],
    template: `
        <p class="m-0 mb-3 max-w-3xl text-sm text-muted-color"><ng-content /></p>
        <app-key-value-editor [items]="draft()" (itemsChange)="draft.set($event)" [label]="label()" [addLabel]="addLabel()" />
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
export class CollectionKeyValues {
    readonly collectionId = input.required<EntityId>();
    readonly field = input.required<'headers' | 'variables'>();
    readonly label = input.required<string>();
    readonly addLabel = input('Add');

    private readonly collections = inject(CollectionsState);

    protected readonly saved = computed<KeyValue[]>(() => this.collections.find(this.collectionId())?.manifest[this.field()] ?? []);
    /** Edição local; volta ao salvo quando o arquivo muda (Save, Git, editor externo). */
    protected readonly draft = linkedSignal(() => this.saved());
    protected readonly dirty = computed(() => JSON.stringify(this.draft()) !== JSON.stringify(this.saved()));
    protected readonly saving = signal(false);
    protected readonly error = signal<string | null>(null);

    constructor() {
        inject(TemplateScope).connect(this.collectionId);
    }

    protected async save(): Promise<void> {
        this.saving.set(true);
        this.error.set(null);

        try {
            // Linhas totalmente vazias são descartadas.
            await this.collections.updateManifest(this.collectionId(), { [this.field()]: this.draft().filter((item) => item.key.trim() || item.value) });
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        } finally {
            this.saving.set(false);
        }
    }
}
