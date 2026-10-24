import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import type { EntityId, RequestScripts } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { CollectionsState } from '../../core/state/collections.state';
import { TemplateScope } from '../../core/templating/template-scope';
import { ScriptEditor } from '../../shared/script-editor/script-editor';

/**
 * Scripts executados em todas as requisições da coleção (`otto.yaml`) ou de uma pasta
 * (`_folder.yaml`): antes dos scripts das pastas internas e da própria requisição.
 */
@Component({
    selector: 'app-scope-scripts',
    imports: [ButtonModule, MessageModule, ScriptEditor],
    providers: [TemplateScope],
    template: `
        <p id="scope-scripts-help" class="m-0 mb-4 max-w-3xl text-sm text-muted-color">
            Run for every request {{ folder() === null ? 'of this collection' : 'inside this folder' }}, in order: collection, then each folder from the outside in, then the request. Pre-request scripts can change the request with
            <code>otto.request.setHeader(…)</code> and others; an error stops the request. Their output appears in the Console tab of the response, marked with where they came from.
        </p>
        <div class="grid gap-4 xl:grid-cols-2">
            <section class="flex min-h-72 flex-col gap-2" aria-labelledby="scope-pre-request-label">
                <div class="flex items-center gap-2">
                    <h3 id="scope-pre-request-label" class="m-0 text-sm font-medium">Pre-request</h3>
                    <p-button class="ms-auto" label="Format" icon="pi pi-align-left" size="small" severity="secondary" [text]="true" (onClick)="pre.format()" />
                </div>
                <app-script-editor
                    #pre
                    class="min-h-64 flex-1"
                    phase="preRequest"
                    ariaLabel="Pre-request script"
                    ariaDescribedBy="scope-scripts-help"
                    [value]="draft().preRequest ?? ''"
                    (valueChange)="change({ preRequest: $event })"
                />
            </section>
            <section class="flex min-h-72 flex-col gap-2" aria-labelledby="scope-post-response-label">
                <div class="flex items-center gap-2">
                    <h3 id="scope-post-response-label" class="m-0 text-sm font-medium">Post-response</h3>
                    <p-button class="ms-auto" label="Format" icon="pi pi-align-left" size="small" severity="secondary" [text]="true" (onClick)="post.format()" />
                </div>
                <app-script-editor
                    #post
                    class="min-h-64 flex-1"
                    phase="postResponse"
                    ariaLabel="Post-response script"
                    ariaDescribedBy="scope-scripts-help"
                    [value]="draft().postResponse ?? ''"
                    (valueChange)="change({ postResponse: $event })"
                />
            </section>
        </div>
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
export class ScopeScripts {
    readonly collectionId = input.required<EntityId>();
    /** Pasta (`a/b`); `null` = a coleção. */
    readonly folder = input<string | null>(null);

    private readonly collections = inject(CollectionsState);

    protected readonly saved = computed<RequestScripts>(() => {
        const folder = this.folder();

        return folder === null ? (this.collections.find(this.collectionId())?.manifest.scripts ?? {}) : (this.collections.findFolder(this.collectionId(), folder)?.settings.scripts ?? {});
    });
    protected readonly draft = linkedSignal(() => this.saved());
    protected readonly dirty = computed(() => (this.draft().preRequest ?? '') !== (this.saved().preRequest ?? '') || (this.draft().postResponse ?? '') !== (this.saved().postResponse ?? ''));
    protected readonly saving = signal(false);
    protected readonly error = signal<string | null>(null);

    constructor() {
        inject(TemplateScope).connect(this.collectionId, () => null, () => this.folder() ?? '');
    }

    protected change(patch: RequestScripts): void {
        this.draft.update((scripts) => ({ ...scripts, ...patch }));
    }

    protected async save(): Promise<void> {
        const folder = this.folder();
        const scripts = this.draft();

        this.saving.set(true);
        this.error.set(null);

        try {
            if (folder === null) {
                await this.collections.updateManifest(this.collectionId(), { scripts });
            } else {
                await this.collections.updateFolder(this.collectionId(), folder, { scripts });
            }
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        } finally {
            this.saving.set(false);
        }
    }
}
