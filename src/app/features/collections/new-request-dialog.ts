import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { emptyRequest, HTTP_METHODS, type HttpMethod } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { CollectionFilesGateway } from '../../core/ports';
import { CollectionsState } from '../../core/state/collections.state';
import { TabsState } from '../../core/state/tabs.state';
import { UiState } from '../../core/state/ui.state';
import { EnterSubmit } from '../../shared/enter-submit.directive';

/** Cria um arquivo de requisição na pasta escolhida e abre em uma aba. */
@Component({
    selector: 'app-new-request-dialog',
    imports: [DialogModule, ReactiveFormsModule, EnterSubmit, InputTextModule, SelectModule, ButtonModule, MessageModule],
    template: `
        <p-dialog closeAriaLabel="Close" header="New Request" [modal]="true" [visible]="!!ui.newRequestDialog()" (visibleChange)="!$event && close()" [style]="{ width: '36rem' }" [draggable]="false" appendTo="body">
            <form [formGroup]="form" appEnterSubmit (ngSubmit)="submit()" class="flex flex-col gap-4" id="new-request-form">
                <p class="m-0 text-sm text-muted-color">
                    In <strong class="text-color">{{ location() }}</strong>
                </p>
                <div class="flex flex-col gap-2">
                    <label for="request-name" class="font-medium">Name</label>
                    <input pInputText id="request-name" formControlName="name" autocomplete="off" placeholder="List users" />
                </div>
                <div class="flex flex-col gap-2">
                    <label for="request-url" class="font-medium">URL</label>
                    <div class="flex gap-2">
                        <p-select formControlName="method" [options]="methods" inputId="request-method" ariaLabel="Method" class="w-32" />
                        <input pInputText id="request-url" class="min-w-0 flex-1" formControlName="url" autocomplete="off" spellcheck="false" [placeholder]="urlPlaceholder" />
                    </div>
                </div>
                @if (error(); as message) {
                    <p-message severity="error"
                        ><span role="alert">{{ message }}</span></p-message
                    >
                }
            </form>
            <ng-template #footer>
                <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="close()" />
                <p-button label="Create" (onClick)="submit()" icon="pi pi-check" [loading]="busy()" [disabled]="form.invalid" />
            </ng-template>
        </p-dialog>
    `
})
export class NewRequestDialog {
    protected readonly ui = inject(UiState);
    private readonly collections = inject(CollectionsState);
    private readonly files = inject(CollectionFilesGateway);
    private readonly tabs = inject(TabsState);

    protected readonly methods = [...HTTP_METHODS];
    protected readonly urlPlaceholder = '{{$.baseUrl}}/users';
    private readonly fb = inject(FormBuilder).nonNullable;
    protected readonly busy = signal(false);
    protected readonly error = signal<string | null>(null);
    protected readonly form = this.fb.group({
        name: ['', [Validators.required, Validators.maxLength(200)]],
        method: this.fb.control<HttpMethod>('GET'),
        url: ['']
    });

    protected readonly location = computed(() => {
        const target = this.ui.newRequestDialog();
        const collection = this.collections.find(target?.collectionId ?? null);

        return collection ? [collection.metadata.name, ...(target?.folder ? target.folder.split('/') : [])].join(' / ') : '';
    });

    protected async submit(): Promise<void> {
        const target = this.ui.newRequestDialog();

        if (!target || this.form.invalid || this.busy()) {
            return;
        }

        const { name, method, url } = this.form.getRawValue();

        this.busy.set(true);
        this.error.set(null);

        try {
            const request = { ...emptyRequest(name.trim()), method, url: url.trim() };
            const path = await this.files.createRequest(target.collectionId, target.folder, request);

            this.tabs.open({ kind: 'request', title: request.name, collectionId: target.collectionId, resourceRef: path });
            this.close();
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        } finally {
            this.busy.set(false);
        }
    }

    protected close(): void {
        this.ui.newRequestDialog.set(null);
        this.form.reset();
        this.error.set(null);
    }
}
