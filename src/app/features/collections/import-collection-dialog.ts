import { Component, computed, inject, signal, type WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import type { CollectionImportRequest } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { DialogGateway } from '../../core/ports';
import { CollectionsState } from '../../core/state/collections.state';
import { TabsState } from '../../core/state/tabs.state';
import { UiState } from '../../core/state/ui.state';

type ImportType = CollectionImportRequest['type'];
type SpecSource = 'url' | 'file';

/**
 * Importa uma coleção para o workspace ativo: backup do Otto (.zip com arquivos e
 * ambientes, gerado por "Export Collection") ou spec OpenAPI/Swagger (URL ou arquivo).
 */
@Component({
    selector: 'app-import-collection-dialog',
    imports: [ReactiveFormsModule, DialogModule, InputTextModule, ButtonModule, MessageModule, SelectButtonModule, CheckboxModule],
    template: `
        <p-dialog closeAriaLabel="Close" header="Import Collection" [modal]="true" [visible]="ui.importCollectionDialog()" (visibleChange)="!$event && close()" [style]="{ width: '58rem', maxWidth: '95vw' }" [draggable]="false" appendTo="body">
            <form class="grid grid-cols-1 gap-6 md:grid-cols-[19rem_1fr]" [formGroup]="form" (ngSubmit)="submit()">
                <aside class="flex flex-col gap-3 rounded-lg border border-surface-200 bg-surface-50 p-4 text-sm dark:border-surface-700 dark:bg-surface-900" aria-labelledby="import-info-title">
                    @if (type() === 'backup') {
                        <div class="flex items-center gap-2">
                            <i class="pi pi-box text-primary" aria-hidden="true"></i>
                            <strong id="import-info-title">Otto → Otto</strong>
                            <span class="ml-auto rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-contrast">Recommended</span>
                        </div>
                        <p class="m-0 text-muted-color">The most complete option, everything ready to use:</p>
                        <ul class="m-0 flex list-disc flex-col gap-1 pl-5">
                            <li>Requests, folders, collection headers and docs</li>
                            <li>Environments and variables (secret values stay in the source machine's vault and come empty)</li>
                            <li>The linked OpenAPI spec</li>
                        </ul>
                        <p class="m-0 mt-auto text-muted-color">Create the file with <em>Export Collection → Otto Backup (ZIP)</em>.</p>
                    } @else {
                        <div class="flex items-center gap-2">
                            <i class="pi pi-info-circle text-primary" aria-hidden="true"></i>
                            <strong id="import-info-title">OpenAPI 3.x / Swagger 2.0</strong>
                        </div>
                        <ul class="m-0 flex list-disc flex-col gap-1 pl-5">
                            <li>Each operation becomes a request, grouped in folders by tag</li>
                            <li>Parameters, headers, example bodies and auth schemes are converted</li>
                            <li>A <em>Default</em> environment is created with <code>baseUrl</code> from the first server</li>
                            <li>Stays linked to the spec to review and sync changes later</li>
                        </ul>
                        <p class="m-0 mt-auto text-muted-color">Responses, scripts and secret values are not part of a spec.</p>
                    }
                </aside>

                <div class="flex flex-col gap-4">
                    <div class="flex flex-col gap-2">
                        <span id="import-type-label" class="font-medium">Import from</span>
                        <p-selectbutton formControlName="type" [options]="types" optionLabel="label" optionValue="value" [allowEmpty]="false" ariaLabelledBy="import-type-label" />
                    </div>

                    @if (type() === 'backup') {
                        <div class="flex flex-col gap-2">
                            <label for="import-backup-file" class="font-medium">Backup file</label>
                            <div class="flex gap-2">
                                <input pInputText id="import-backup-file" class="flex-1" [value]="archive() ?? ''" readonly placeholder="Choose an Otto backup (.zip)" />
                                <p-button label="Choose .zip…" icon="pi pi-file" severity="secondary" (onClick)="browseArchive()" />
                            </div>
                        </div>
                    } @else {
                        <div class="flex flex-col gap-2">
                            <span id="import-spec-source-label" class="font-medium">Spec source</span>
                            <p-selectbutton formControlName="specSource" [options]="sources" optionLabel="label" optionValue="value" [allowEmpty]="false" ariaLabelledBy="import-spec-source-label" size="small" />
                        </div>

                        @if (specSource() === 'url') {
                            <div class="flex flex-col gap-2">
                                <label for="import-spec-url" class="font-medium">Spec URL</label>
                                <input pInputText id="import-spec-url" type="url" formControlName="url" placeholder="https://api.example.com/openapi.json" aria-describedby="import-spec-url-help" />
                                <small id="import-spec-url-help" class="text-muted-color">JSON or YAML, over http(s).</small>
                            </div>
                        } @else {
                            <div class="flex flex-col gap-2">
                                <label for="import-spec-file" class="font-medium">Spec file</label>
                                <div class="flex gap-2">
                                    <input pInputText id="import-spec-file" class="flex-1" [value]="specFile() ?? ''" readonly placeholder="Choose a .json or .yaml file" />
                                    <p-button label="Choose File…" icon="pi pi-file" severity="secondary" (onClick)="browseSpec()" />
                                </div>
                            </div>
                        }

                        <div class="flex items-start gap-2">
                            <p-checkbox formControlName="autoSync" [binary]="true" inputId="import-auto-sync" ariaLabelledBy="import-auto-sync-label" />
                            <div class="flex flex-col">
                                <label id="import-auto-sync-label" for="import-auto-sync" class="font-medium">Enable auto sync</label>
                                <small class="text-muted-color">Otto checks the spec for updates periodically and lets you review them. You can change this later in the collection's OpenAPI settings.</small>
                            </div>
                        </div>
                    }

                    @if (error(); as message) {
                        <p-message severity="error"
                            ><span role="alert">{{ message }}</span></p-message
                        >
                    }
                </div>
            </form>
            <ng-template #footer>
                <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="close()" />
                <p-button label="Import" icon="pi pi-download" [loading]="busy()" [disabled]="!request()" (onClick)="submit()" />
            </ng-template>
        </p-dialog>
    `
})
export class ImportCollectionDialog {
    protected readonly ui = inject(UiState);
    private readonly collections = inject(CollectionsState);
    private readonly tabs = inject(TabsState);
    private readonly dialogs = inject(DialogGateway);

    protected readonly types: Array<{ label: string; value: ImportType }> = [
        { label: 'Otto Backup (ZIP)', value: 'backup' },
        { label: 'OpenAPI Spec', value: 'openapi' }
    ];

    protected readonly sources: Array<{ label: string; value: SpecSource }> = [
        { label: 'URL', value: 'url' },
        { label: 'File', value: 'file' }
    ];

    protected readonly form = inject(FormBuilder).nonNullable.group({
        type: 'backup' as ImportType,
        specSource: 'url' as SpecSource,
        url: '',
        autoSync: false
    });

    private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

    protected readonly type = computed(() => this.value().type);
    protected readonly specSource = computed(() => this.value().specSource);
    protected readonly archive = signal<string | null>(null);
    protected readonly specFile = signal<string | null>(null);
    protected readonly busy = signal(false);
    protected readonly error = signal<string | null>(null);

    /** Pedido de importação montado do formulário; `null` enquanto falta a origem. */
    protected readonly request = computed<CollectionImportRequest | null>(() => {
        const { type, specSource, url, autoSync } = { ...this.form.getRawValue(), ...this.value() };

        if (type === 'backup') {
            const file = this.archive();

            return file ? { type, file } : null;
        }

        const location = specSource === 'url' ? url.trim() : this.specFile();

        if (!location || (specSource === 'url' && !/^https?:\/\/\S+$/i.test(location))) {
            return null;
        }

        return { type, source: { type: specSource, location }, autoSync };
    });

    protected async browseArchive(): Promise<void> {
        this.pick(this.archive, await this.dialogs.pickCollectionArchive());
    }

    protected async browseSpec(): Promise<void> {
        this.pick(this.specFile, await this.dialogs.pickOpenApiFile());
    }

    protected async submit(): Promise<void> {
        const request = this.request();

        if (!request || this.busy()) {
            return;
        }

        this.busy.set(true);
        this.error.set(null);

        try {
            const imported = await this.collections.import(request);

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
        this.form.reset();
        this.archive.set(null);
        this.specFile.set(null);
        this.error.set(null);
    }

    private pick(target: WritableSignal<string | null>, file: string | null): void {
        if (file) {
            target.set(file);
            this.error.set(null);
        }
    }
}
