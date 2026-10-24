import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { parentFolder } from '@shared/http/inheritance';
import type { EntityId, RequestAuth } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { CollectionsState } from '../../core/state/collections.state';
import { TemplateContextService } from '../../core/templating/template-context.service';
import { TemplateScope } from '../../core/templating/template-scope';
import { AuthEditor } from '../request/auth-editor';

/**
 * Autenticação herdada pelas requisições com "Inherit": a da coleção (`otto.yaml`) ou a de
 * uma pasta (`_folder.yaml`, com `folder`). Os campos aceitam variáveis e comandos `otto`.
 */
@Component({
    selector: 'app-scope-auth',
    imports: [ButtonModule, MessageModule, AuthEditor],
    providers: [TemplateScope],
    template: `
        <p class="m-0 mb-4 max-w-3xl text-sm text-muted-color">
            @if (folder() === null) {
                Used by every request and folder of this collection whose authentication is <strong>Inherit from parent</strong> (the default for new requests). Values accept variables and commands, like
                <code>{{ example }}</code>, resolved when each request is sent.
            } @else {
                Used by the requests and subfolders of this folder whose authentication is <strong>Inherit from parent</strong>. Keep <strong>Inherit</strong> here to use the authentication of the parent folder or of the
                collection. Values accept variables and commands, like <code>{{ example }}</code>.
            }
        </p>
        <app-auth-editor [auth]="draft()" (authChange)="draft.set($event)" [allowInherit]="folder() !== null" [inherited]="inherited()" />
        @if (error(); as message) {
            <p-message severity="error" styleClass="mt-3"
                ><span role="alert">{{ message }}</span></p-message
            >
        }
        <div class="mt-4 flex items-center gap-2">
            <p-button label="Save" icon="pi pi-check" size="small" [disabled]="!dirty()" [loading]="saving()" (onClick)="save()" />
            <p-button label="Discard Changes" size="small" severity="secondary" [text]="true" [disabled]="!dirty()" (onClick)="draft.set(saved())" />
            @if (dirty()) {
                <span class="text-xs text-muted-color" role="status">Unsaved changes</span>
            }
        </div>
    `,
    host: { class: 'block' }
})
export class ScopeAuth {
    readonly collectionId = input.required<EntityId>();
    /** Pasta (`a/b`); `null` = a coleção. */
    readonly folder = input<string | null>(null);

    private readonly collections = inject(CollectionsState);
    private readonly templates = inject(TemplateContextService);

    protected readonly example = "{{ otto.request('rq_…', { send: 'expired', maxAge: 3000 }).response.json('$.access_token') }}";
    protected readonly saved = computed<RequestAuth>(() => {
        const folder = this.folder();

        return folder === null ? (this.collections.find(this.collectionId())?.manifest.auth ?? { type: 'none' }) : (this.collections.findFolder(this.collectionId(), folder)?.settings.auth ?? { type: 'inherit' });
    });
    /** Edição local; volta ao salvo quando o arquivo muda (Save, Git, editor externo). */
    protected readonly draft = linkedSignal(() => this.saved());
    protected readonly dirty = computed(() => JSON.stringify(this.draft()) !== JSON.stringify(this.saved()));
    /** Numa pasta, "Inherit" usa a da pasta pai ou a da coleção. */
    protected readonly inherited = computed(() => {
        const folder = this.folder();

        return folder === null ? null : this.templates.inheritedAuth(this.collectionId(), parentFolder(folder));
    });
    protected readonly saving = signal(false);
    protected readonly error = signal<string | null>(null);

    constructor() {
        inject(TemplateScope).connect(this.collectionId, () => null, () => this.folder() ?? '');
    }

    protected async save(): Promise<void> {
        const folder = this.folder();

        this.saving.set(true);
        this.error.set(null);

        try {
            if (folder === null) {
                await this.collections.updateManifest(this.collectionId(), { auth: this.draft() });
            } else {
                await this.collections.updateFolder(this.collectionId(), folder, { auth: this.draft() });
            }
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        } finally {
            this.saving.set(false);
        }
    }
}
