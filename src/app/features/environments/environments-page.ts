import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, type FormControl, type FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import type { EntityId, Environment, EnvironmentVariable } from '@shared/models';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { TooltipModule } from 'primeng/tooltip';
import { map } from 'rxjs';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { CollectionsState } from '../../core/state/collections.state';
import { ConfirmState } from '../../core/state/confirm.state';
import { EnvironmentsState } from '../../core/state/environments.state';

import { TemplateScope } from '../../core/templating/template-scope';
import { OttoInput } from '../../shared/template-editor';
type VariableForm = FormGroup<{ enabled: FormControl<boolean>; key: FormControl<string>; value: FormControl<string>; secret: FormControl<boolean> }>;

/**
 * Cadastro de ambientes: globais do workspace (`collectionId = null`) ou de uma coleção.
 * Lista à esquerda; à direita, nome e variáveis (`{{nome}}` nas requisições).
 */
@Component({
    selector: 'app-environments-page',
    imports: [ReactiveFormsModule, ButtonModule, CheckboxModule, InputTextModule, MessageModule, TooltipModule, OttoInput],
    providers: [TemplateScope],
    template: `
        <nav class="flex w-60 shrink-0 flex-col gap-2 border-r border-surface-200 p-3 dark:border-surface-700" aria-labelledby="environments-heading">
            <div class="flex items-center gap-2">
                <h2 id="environments-heading" class="m-0 flex-1 text-sm font-semibold">Environment</h2>
                <button type="button" class="otto-icon-button" aria-label="New environment" pTooltip="New environment" tooltipPosition="bottom" (click)="create()">
                    <i class="pi pi-plus" aria-hidden="true"></i>
                </button>
            </div>
            @if (environments().length) {
                <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
                    @for (environment of environments(); track environment.id) {
                        <li>
                            <button
                                type="button"
                                class="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 px-2 py-1.5 text-left text-sm"
                                [class]="environment.id === selectedId() ? 'bg-surface-100 font-medium text-color dark:bg-surface-800' : 'bg-transparent text-color hover:bg-surface-100 dark:hover:bg-surface-800'"
                                [attr.aria-current]="environment.id === selectedId() ? 'true' : null"
                                (click)="select(environment.id)"
                            >
                                <i class="pi pi-globe text-xs text-muted-color" aria-hidden="true"></i>
                                <span class="min-w-0 flex-1 truncate">{{ environment.name }}</span>
                                <span class="text-xs text-muted-color">{{ environment.variables.length }}</span>
                            </button>
                        </li>
                    }
                </ul>
            } @else {
                <p class="m-0 text-sm text-muted-color">No environments yet.</p>
                <p-button label="New Environment" icon="pi pi-plus" size="small" (onClick)="create()" />
            }
        </nav>

        <section class="flex min-w-0 flex-1 flex-col gap-4 overflow-auto p-4" aria-label="Environment details">
            @if (selected(); as environment) {
                <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-4">
                    <div class="flex flex-wrap items-end gap-2">
                        <div class="flex min-w-60 flex-1 flex-col gap-2">
                            <label for="environment-name" class="font-medium">Name</label>
                            <input pInputText id="environment-name" formControlName="name" autocomplete="off" [attr.aria-invalid]="form.controls.name.invalid" />
                        </div>
                        <p-button label="Duplicate" icon="pi pi-copy" severity="secondary" [text]="true" (onClick)="duplicate(environment)" />
                        <p-button label="Delete" icon="pi pi-trash" severity="danger" [text]="true" (onClick)="remove(environment)" />
                    </div>

                    <table class="w-full border-collapse text-sm">
                        <caption class="sr-only">
                            Variables
                        </caption>
                        <thead>
                            <tr class="text-left text-xs text-muted-color">
                                <th scope="col" class="w-10 border-b border-surface-200 py-1.5 font-medium dark:border-surface-700"><span class="sr-only">Enabled</span></th>
                                <th scope="col" class="w-1/3 border-b border-surface-200 py-1.5 font-medium dark:border-surface-700">Variable</th>
                                <th scope="col" class="border-b border-surface-200 py-1.5 font-medium dark:border-surface-700">Value</th>
                                <th scope="col" class="w-20 border-b border-surface-200 py-1.5 font-medium dark:border-surface-700">Secret</th>
                                <th scope="col" class="w-10 border-b border-surface-200 py-1.5 dark:border-surface-700"><span class="sr-only">Remove</span></th>
                            </tr>
                        </thead>
                        <tbody formArrayName="variables">
                            @for (row of variables.controls; track row; let i = $index) {
                                <tr [formGroupName]="i">
                                    <td class="border-b border-surface-100 py-1 dark:border-surface-800">
                                        <p-checkbox formControlName="enabled" [binary]="true" [ariaLabel]="'Enable variable ' + (i + 1)" />
                                    </td>
                                    <td class="border-b border-surface-100 py-1 pr-2 dark:border-surface-800">
                                        <input pInputText formControlName="key" class="w-full font-mono !text-sm" pSize="small" placeholder="baseUrl" autocomplete="off" spellcheck="false" [attr.aria-label]="'Variable ' + (i + 1) + ' name'" />
                                    </td>
                                    <td class="border-b border-surface-100 py-1 pr-2 dark:border-surface-800">
                                        <app-otto-input
                                            formControlName="value"
                                            class="w-full !text-sm"
                                            size="small"
                                            [type]="row.controls.secret.value ? 'password' : 'text'"
                                            [ariaLabel]="'Variable ' + (i + 1) + ' value'"
                                        />
                                    </td>
                                    <td class="border-b border-surface-100 py-1 dark:border-surface-800">
                                        <p-checkbox formControlName="secret" [binary]="true" [ariaLabel]="'Hide value of variable ' + (i + 1)" />
                                    </td>
                                    <td class="border-b border-surface-100 py-1 dark:border-surface-800">
                                        <button type="button" class="otto-icon-button" [attr.aria-label]="'Remove variable ' + (i + 1)" (click)="removeVariable(i)">
                                            <i class="pi pi-trash text-xs" aria-hidden="true"></i>
                                        </button>
                                    </td>
                                </tr>
                            }
                        </tbody>
                    </table>

                    <div>
                        <p-button label="Add Variable" icon="pi pi-plus" size="small" severity="secondary" [outlined]="true" (onClick)="addVariable()" />
                    </div>

                    <p class="m-0 text-xs text-muted-color">
                        Use variables in URLs, headers and bodies as <code>{{ example }}</code
                        >. Disabled variables are kept but not used. Secret values are hidden on screen.
                    </p>

                    @if (error(); as message) {
                        <p-message severity="error"
                            ><span role="alert">{{ message }}</span></p-message
                        >
                    }

                    <div class="flex items-center gap-2">
                        <p-button type="submit" label="Save" icon="pi pi-check" [disabled]="form.pristine || form.invalid" [loading]="saving()" />
                        <p-button label="Discard Changes" severity="secondary" [text]="true" [disabled]="form.pristine" (onClick)="reset(environment)" />
                        @if (form.dirty) {
                            <span class="text-xs text-muted-color" role="status">Unsaved changes</span>
                        }
                    </div>
                </form>
            } @else {
                <div class="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                    <i class="pi pi-globe !text-4xl text-surface-400" aria-hidden="true"></i>
                    <p class="m-0 text-sm text-muted-color">{{ environments().length ? 'Select an environment to edit its variables.' : 'Create an environment to store variables like a base URL or a token.' }}</p>
                </div>
            }
        </section>
    `,
    host: { class: 'flex h-full min-h-0' }
})
export class EnvironmentsPage {
    /** `null` = ambientes globais do workspace. */
    readonly collectionId = input<EntityId | null>(null);
    protected readonly example = '{{$.baseUrl}}';
    protected readonly selectedId = signal<EntityId | null>(null);
    protected readonly saving = signal(false);
    protected readonly error = signal<string | null>(null);
    protected readonly selected = computed(() => this.environments().find((env) => env.id === this.selectedId()) ?? null);
    private readonly state = inject(EnvironmentsState);
    protected readonly environments = computed(() => this.state.list(this.collectionId()));
    private readonly collections = inject(CollectionsState);
    private readonly confirm = inject(ConfirmState);
    private readonly messages = inject(MessageService);
    private readonly fb = inject(FormBuilder).nonNullable;
    protected readonly form = this.fb.group({
        name: this.fb.control('', [Validators.required, Validators.maxLength(200)]),
        variables: this.fb.array<VariableForm>([])
    });
    private loadedId: EntityId | null = null;
    /** Variáveis do formulário (para os chips reconhecerem as que ainda não foram salvas). */
    private readonly editing = toSignal(this.form.valueChanges.pipe(map(() => this.variables.getRawValue())), { initialValue: [] });

    constructor() {
        const scope = inject(TemplateScope);

        scope.connect(this.collectionId);
        scope.connectLocal(() => {
            const environment = this.selected();

            return environment ? { scope: 'env', label: environment.name, items: this.editing() } : null;
        });
        effect(() => {
            const collectionId = this.collectionId();

            untracked(() => void this.state.load(collectionId));
        });

        // Seleciona o primeiro ambiente quando nada está selecionado (ou o selecionado sumiu).
        effect(() => {
            const list = this.environments();

            untracked(() => {
                if (!list.some((env) => env.id === this.selectedId())) {
                    this.selectedId.set(list[0]?.id ?? null);
                }
            });
        });

        // Carrega o formulário ao trocar de ambiente.
        effect(() => {
            const environment = this.selected();

            untracked(() => {
                if (environment && (this.form.pristine || this.loadedId !== environment.id)) {
                    this.reset(environment);
                }
            });
        });
    }

    protected get variables(): FormArray<VariableForm> {
        return this.form.controls.variables;
    }

    protected async select(id: EntityId): Promise<void> {
        if (id === this.selectedId() || !(await this.confirmDiscard())) {
            return;
        }

        this.selectedId.set(id);
    }

    protected async create(): Promise<void> {
        if (!(await this.confirmDiscard())) {
            return;
        }

        try {
            const created = await this.state.create(this.collectionId());

            this.form.markAsPristine();
            this.selectedId.set(created.id);
            queueMicrotask(() => document.getElementById('environment-name')?.focus());
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not create the environment', detail: ipcErrorMessage(error), life: 6000 });
        }
    }

    protected async duplicate(environment: Environment): Promise<void> {
        if (!(await this.confirmDiscard())) {
            return;
        }

        try {
            const copy = await this.state.create(this.collectionId(), `${environment.name} copy`, environment.variables);

            this.form.markAsPristine();
            this.selectedId.set(copy.id);
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not duplicate the environment', detail: ipcErrorMessage(error), life: 6000 });
        }
    }

    protected async remove(environment: Environment): Promise<void> {
        const accepted = await this.confirm.ask({ header: 'Delete Environment', message: `Delete "${environment.name}" and its ${environment.variables.length} variables?`, acceptLabel: 'Delete', severity: 'danger' });

        if (!accepted) {
            return;
        }

        try {
            this.form.markAsPristine();
            await this.state.remove(environment);
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not delete the environment', detail: ipcErrorMessage(error), life: 6000 });
        }
    }

    protected addVariable(): void {
        this.variables.push(this.variableForm({ key: '', value: '', enabled: true, secret: false }));
        this.form.markAsDirty();
        queueMicrotask(() => {
            const inputs = document.querySelectorAll<HTMLInputElement>('app-environments-page tbody tr:last-child input[formcontrolname="key"]');

            inputs[inputs.length - 1]?.focus();
        });
    }

    protected removeVariable(index: number): void {
        this.variables.removeAt(index);
        this.form.markAsDirty();
    }

    protected async save(): Promise<void> {
        const environment = this.selected();

        if (!environment || this.form.invalid || this.saving()) {
            return;
        }

        const { name, variables } = this.form.getRawValue();

        this.saving.set(true);
        this.error.set(null);

        try {
            // Linhas totalmente vazias são descartadas.
            const updated = await this.state.update(environment, { name: name.trim(), variables: variables.filter((v) => v.key.trim() || v.value).map((v) => ({ ...v, key: v.key.trim() })) });

            this.reset(updated);
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        } finally {
            this.saving.set(false);
        }
    }

    protected reset(environment: Environment): void {
        this.loadedId = environment.id;
        this.variables.clear({ emitEvent: false });
        environment.variables.forEach((variable) => this.variables.push(this.variableForm(variable), { emitEvent: false }));
        this.form.controls.name.setValue(environment.name);
        this.form.markAsPristine();
        this.error.set(null);
    }

    private variableForm(variable: EnvironmentVariable): VariableForm {
        return this.fb.group({
            enabled: this.fb.control(variable.enabled),
            key: this.fb.control(variable.key, Validators.maxLength(500)),
            value: this.fb.control(variable.value),
            secret: this.fb.control(variable.secret)
        });
    }

    private async confirmDiscard(): Promise<boolean> {
        if (this.form.pristine) {
            return true;
        }

        const discard = await this.confirm.ask({ header: 'Unsaved Changes', message: 'Discard the changes to this environment?', acceptLabel: 'Discard', severity: 'danger' });

        if (discard) {
            this.form.markAsPristine();
        }

        return discard;
    }
}
