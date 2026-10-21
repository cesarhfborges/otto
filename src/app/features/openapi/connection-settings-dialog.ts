import { Component, effect, inject, input, model, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators, type AbstractControl, type ValidationErrors } from '@angular/forms';
import { OPENAPI_CHECK_INTERVALS, type EntityId, type OpenApiCheckInterval, type OpenApiConfig, type OpenApiGrouping } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { DialogGateway } from '../../core/ports';
import { ConfirmState } from '../../core/state/confirm.state';
import { OpenApiState } from '../../core/state/openapi.state';

/** URL http(s) quando a origem é URL; caminho preenchido quando é arquivo. */
const locationValidator = (control: AbstractControl): ValidationErrors | null => {
    const { type, location } = control.value as { type: 'url' | 'file'; location: string };

    if (!location.trim()) {
        return { required: true };
    }

    return type === 'url' && !/^https?:\/\/\S+$/i.test(location.trim()) ? { url: true } : null;
};

/** Origem do spec, verificação automática e agrupamento das requisições geradas. */
@Component({
    selector: 'app-connection-settings-dialog',
    imports: [ReactiveFormsModule, DialogModule, ButtonModule, InputTextModule, MessageModule, SelectButtonModule, ToggleSwitchModule],
    template: `
        <p-dialog closeAriaLabel="Close" header="Connection Settings" [modal]="true" [(visible)]="visible" [style]="{ width: '34rem' }" [draggable]="false" appendTo="body">
            <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-5">
                <fieldset formGroupName="source" class="m-0 flex flex-col gap-2 border-0 p-0">
                    <legend id="spec-source-label" class="mb-2 font-medium">Spec source</legend>
                    <p-select-button formControlName="type" [options]="sourceTypes" optionLabel="label" optionValue="value" [allowEmpty]="false" ariaLabelledBy="spec-source-label" size="small" />
                    @if (form.controls.source.controls.type.value === 'url') {
                        <label for="spec-url" class="sr-only">Spec URL</label>
                        <input
                            pInputText
                            id="spec-url"
                            formControlName="location"
                            class="font-mono !text-sm"
                            placeholder="http://localhost:3000/api/swagger/json"
                            autocomplete="off"
                            spellcheck="false"
                            [attr.aria-invalid]="locationInvalid()"
                            aria-describedby="spec-location-help"
                        />
                    } @else {
                        <div class="flex gap-2">
                            <label for="spec-file" class="sr-only">Spec file</label>
                            <input pInputText id="spec-file" class="min-w-0 flex-1 font-mono !text-sm" [value]="form.controls.source.controls.location.value" readonly placeholder="Select a .json or .yaml file" aria-describedby="spec-location-help" />
                            <p-button label="Select File" icon="pi pi-folder-open" severity="secondary" size="small" (onClick)="chooseFile()" />
                        </div>
                    }
                    <small id="spec-location-help" class="text-muted-color">OpenAPI 3.x or Swagger 2.0, in JSON or YAML. URLs are downloaded using the proxy and certificate preferences.</small>
                </fieldset>

                <div class="flex items-center justify-between gap-3">
                    <div>
                        <label id="auto-check-label" for="auto-check" class="font-medium">Auto-check for updates</label>
                        <p class="m-0 text-sm text-muted-color">Automatically check for spec changes at a regular interval while the collection is open.</p>
                    </div>
                    <div class="flex-none">
                        <p-toggleswitch size="large" formControlName="autoCheck" inputId="auto-check" ariaLabelledBy="auto-check-label" />
                    </div>
                </div>

                @if (form.controls.autoCheck.value) {
                    <div class="flex flex-col gap-2">
                        <span id="interval-label" class="font-medium">Check interval</span>
                        <p-select-button formControlName="intervalMinutes" [options]="intervals" optionLabel="label" optionValue="value" [allowEmpty]="false" ariaLabelledBy="interval-label" size="small" />
                    </div>
                }

                <div class="flex flex-col gap-2">
                    <span id="grouping-label" class="font-medium">Folder grouping</span>
                    <p-select-button formControlName="groupBy" [options]="groupings" optionLabel="label" optionValue="value" [allowEmpty]="false" ariaLabelledBy="grouping-label" size="small" />
                    <small class="text-muted-color">Where new requests from the spec are created: one folder per tag, or per first path segment.</small>
                </div>

                @if (error(); as message) {
                    <p-message severity="error"
                        ><span role="alert">{{ message }}</span></p-message
                    >
                }
            </form>
            <ng-template #footer>
                @if (linked()) {
                    <p-button label="Disconnect sync" severity="danger" [text]="true" class="mr-auto" (onClick)="disconnect()" />
                }
                <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
                <p-button label="Save" icon="pi pi-check" [loading]="busy()" [disabled]="form.invalid" (onClick)="save()" />
            </ng-template>
        </p-dialog>
    `
})
export class ConnectionSettingsDialog {
    readonly collectionId = input.required<EntityId>();
    readonly config = input<OpenApiConfig | null>(null);
    readonly visible = model(false);

    private readonly openapi = inject(OpenApiState);
    private readonly dialogs = inject(DialogGateway);
    private readonly confirm = inject(ConfirmState);
    private readonly fb = inject(FormBuilder).nonNullable;

    protected readonly busy = signal(false);
    protected readonly error = signal<string | null>(null);
    protected readonly linked = signal(false);
    protected readonly sourceTypes = [
        { label: 'URL', value: 'url' },
        { label: 'File', value: 'file' }
    ];
    protected readonly intervals = OPENAPI_CHECK_INTERVALS.map((value) => ({ label: `${value} min`, value }));
    protected readonly groupings: Array<{ label: string; value: OpenApiGrouping }> = [
        { label: 'Tags', value: 'tags' },
        { label: 'Path', value: 'path' }
    ];

    protected readonly form = this.fb.group({
        source: this.fb.group({ type: this.fb.control<'url' | 'file'>('url'), location: this.fb.control('') }, { validators: [locationValidator] }),
        autoCheck: this.fb.control(true),
        intervalMinutes: this.fb.control<OpenApiCheckInterval>(5, Validators.required),
        groupBy: this.fb.control<OpenApiGrouping>('tags')
    });

    constructor() {
        // Ao abrir, carrega a configuração atual (ou padrões para uma ligação nova).
        effect(() => {
            if (!this.visible()) {
                return;
            }

            const config = this.config();

            untracked(() => {
                this.linked.set(!!config);
                this.error.set(null);
                this.form.reset(
                    config
                        ? { source: { ...config.source }, autoCheck: config.autoCheck, intervalMinutes: config.intervalMinutes, groupBy: config.groupBy }
                        : { source: { type: 'url', location: '' }, autoCheck: true, intervalMinutes: 5, groupBy: 'tags' },
                    { emitEvent: false }
                );
            });
        });

        // Trocar URL ↔ arquivo limpa o local (um não serve para o outro).
        this.form.controls.source.controls.type.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.form.controls.source.controls.location.setValue(''));
    }

    protected locationInvalid(): boolean {
        const source = this.form.controls.source;

        return source.invalid && (source.dirty || source.touched);
    }

    protected async chooseFile(): Promise<void> {
        const file = await this.dialogs.pickFile('Select an OpenAPI / Swagger file');

        if (file) {
            this.form.controls.source.controls.location.setValue(file);
        }
    }

    protected async save(): Promise<void> {
        if (this.form.invalid || this.busy()) {
            this.form.markAllAsTouched();

            return;
        }

        const value = this.form.getRawValue();

        this.busy.set(true);
        this.error.set(null);

        try {
            await this.openapi.connect(this.collectionId(), { ...value, source: { ...value.source, location: value.source.location.trim() } });
            this.visible.set(false);
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        } finally {
            this.busy.set(false);
        }
    }

    protected async disconnect(): Promise<void> {
        const accepted = await this.confirm.ask({ header: 'Disconnect Sync', message: 'Stop syncing this collection with the OpenAPI spec? Requests already in the collection are kept.', acceptLabel: 'Disconnect', severity: 'danger' });

        if (accepted) {
            await this.openapi.disconnect(this.collectionId());
            this.visible.set(false);
        }
    }
}
