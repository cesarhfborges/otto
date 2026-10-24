import { Component, inject, input, model, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators, type AbstractControl, type ValidationErrors } from '@angular/forms';
import { MAX_CLIENT_CERTIFICATES, type ClientCertificate } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';
import { SelectButtonModule } from 'primeng/selectbutton';
import { DialogGateway } from '../../core/ports';

type CertificateFormat = 'pem' | 'pfx';

/** Mesma regra do main: host, `*.` opcional e `:porta` opcional. */
const HOST_PATTERN = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

/** PEM pede certificado e chave; PFX pede o arquivo .pfx/.p12. */
const filesRequired = (group: AbstractControl): ValidationErrors | null => {
    const { format, certPath, keyPath, pfxPath } = group.value as { format: CertificateFormat; certPath: string; keyPath: string; pfxPath: string };

    return (format === 'pfx' ? pfxPath : certPath && keyPath) ? null : { files: true };
};

const fileName = (file: string | null): string => file?.split(/[\\/]/).pop() ?? '';

/** Certificados de cliente (mTLS) por host, editados num diálogo. */
@Component({
    selector: 'app-client-certificates',
    imports: [ReactiveFormsModule, ButtonModule, DialogModule, InputTextModule, MessageModule, PasswordModule, SelectButtonModule],
    template: `
        <div class="flex flex-col gap-3 px-4 py-3">
            <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                    <h4 id="client-certificates-label" class="m-0 text-base font-medium">Client certificates</h4>
                    <p class="m-0 mt-0.5 text-sm text-muted-color">Sent to servers that ask for mutual TLS (mTLS). The first entry whose host matches is used.</p>
                </div>
                <p-button label="Add Certificate" icon="pi pi-plus" severity="secondary" size="small" [disabled]="disabled() || certificates().length >= max" (onClick)="openEditor(null)" />
            </div>
            @if (certificates().length) {
                <ul class="m-0 flex list-none flex-col divide-y divide-surface-200 rounded-md border border-surface-200 p-0 dark:divide-surface-700 dark:border-surface-700" aria-labelledby="client-certificates-label">
                    @for (certificate of certificates(); track $index) {
                        <li class="flex items-center gap-3 px-3 py-2">
                            <i class="pi pi-id-card text-muted-color" aria-hidden="true"></i>
                            <div class="min-w-0 flex-1">
                                <div class="truncate font-mono text-sm">{{ certificate.host }}</div>
                                <div class="truncate text-xs text-muted-color">{{ describe(certificate) }}</div>
                            </div>
                            <p-button icon="pi pi-pencil" severity="secondary" [text]="true" size="small" [ariaLabel]="'Edit certificate for ' + certificate.host" [disabled]="disabled()" (onClick)="openEditor($index)" />
                            <p-button icon="pi pi-trash" severity="danger" [text]="true" size="small" [ariaLabel]="'Remove certificate for ' + certificate.host" [disabled]="disabled()" (onClick)="remove($index)" />
                        </li>
                    }
                </ul>
            }
        </div>

        <p-dialog closeAriaLabel="Close" [header]="editing() === null ? 'Add Client Certificate' : 'Edit Client Certificate'" [modal]="true" [(visible)]="editorVisible" [style]="{ width: '34rem' }" [draggable]="false" appendTo="body">
            <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-5">
                <div class="flex flex-col gap-2">
                    <label for="client-certificate-host" class="font-medium">Host</label>
                    <input
                        pInputText
                        id="client-certificate-host"
                        formControlName="host"
                        class="font-mono !text-sm"
                        placeholder="api.example.com"
                        autocomplete="off"
                        spellcheck="false"
                        [attr.aria-invalid]="form.controls.host.invalid && form.controls.host.touched"
                        aria-describedby="client-certificate-host-help"
                    />
                    <small id="client-certificate-host-help" class="text-muted-color">Host name with an optional port, for example api.example.com:8443. Use *.example.com for all subdomains.</small>
                </div>

                <div class="flex flex-col gap-2">
                    <span id="client-certificate-format-label" class="font-medium">Format</span>
                    <p-select-button formControlName="format" [options]="formats" optionLabel="label" optionValue="value" [allowEmpty]="false" ariaLabelledBy="client-certificate-format-label" size="small" />
                </div>

                @if (form.controls.format.value === 'pem') {
                    <div class="flex flex-col gap-2">
                        <label for="client-certificate-cert" class="font-medium">Certificate (CRT/PEM)</label>
                        <div class="flex gap-2">
                            <input pInputText id="client-certificate-cert" class="min-w-0 flex-1 font-mono !text-sm" [value]="form.controls.certPath.value" readonly placeholder="No file selected" />
                            <p-button label="Select File" icon="pi pi-folder-open" severity="secondary" size="small" (onClick)="choose('certPath', 'Select Client Certificate')" />
                        </div>
                    </div>
                    <div class="flex flex-col gap-2">
                        <label for="client-certificate-key" class="font-medium">Private key (KEY/PEM)</label>
                        <div class="flex gap-2">
                            <input pInputText id="client-certificate-key" class="min-w-0 flex-1 font-mono !text-sm" [value]="form.controls.keyPath.value" readonly placeholder="No file selected" />
                            <p-button label="Select File" icon="pi pi-folder-open" severity="secondary" size="small" (onClick)="choose('keyPath', 'Select Private Key')" />
                        </div>
                    </div>
                } @else {
                    <div class="flex flex-col gap-2">
                        <label for="client-certificate-pfx" class="font-medium">PFX/PKCS#12 file</label>
                        <div class="flex gap-2">
                            <input pInputText id="client-certificate-pfx" class="min-w-0 flex-1 font-mono !text-sm" [value]="form.controls.pfxPath.value" readonly placeholder="No file selected" />
                            <p-button label="Select File" icon="pi pi-folder-open" severity="secondary" size="small" (onClick)="choose('pfxPath', 'Select PFX File')" />
                        </div>
                    </div>
                }

                <div class="flex flex-col gap-2">
                    <label for="client-certificate-passphrase" class="font-medium">Passphrase</label>
                    <p-password inputId="client-certificate-passphrase" formControlName="passphrase" [feedback]="false" [toggleMask]="true" autocomplete="off" styleClass="w-full" inputStyleClass="w-full" />
                    <small id="client-certificate-passphrase-help" class="text-muted-color">Leave empty if the key is not encrypted. Stored encrypted with the system keychain.</small>
                </div>
            </form>
            <ng-template #footer>
                <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="editorVisible.set(false)" />
                <p-button label="Save" icon="pi pi-check" [disabled]="form.invalid" (onClick)="save()" />
            </ng-template>
        </p-dialog>
    `
})
export class ClientCertificates {
    readonly certificates = model<ClientCertificate[]>([]);
    readonly disabled = input(false);

    private readonly dialogs = inject(DialogGateway);
    private readonly fb = inject(FormBuilder).nonNullable;

    protected readonly max = MAX_CLIENT_CERTIFICATES;
    protected readonly editorVisible = signal(false);
    /** Índice em edição; `null` = novo. */
    protected readonly editing = signal<number | null>(null);
    protected readonly formats: Array<{ label: string; value: CertificateFormat }> = [
        { label: 'CRT + KEY', value: 'pem' },
        { label: 'PFX', value: 'pfx' }
    ];

    protected readonly form = this.fb.group(
        {
            host: this.fb.control('', [Validators.required, Validators.pattern(HOST_PATTERN)]),
            format: this.fb.control<CertificateFormat>('pem'),
            certPath: this.fb.control(''),
            keyPath: this.fb.control(''),
            pfxPath: this.fb.control(''),
            passphrase: this.fb.control('')
        },
        { validators: [filesRequired] }
    );

    protected describe(certificate: ClientCertificate): string {
        return certificate.pfxPath ? `PFX: ${fileName(certificate.pfxPath)}` : `${fileName(certificate.certPath)} + ${fileName(certificate.keyPath)}`;
    }

    protected openEditor(index: number | null): void {
        const current = index === null ? null : this.certificates()[index];

        this.editing.set(index);
        this.form.reset({
            host: current?.host ?? '',
            format: current?.pfxPath ? 'pfx' : 'pem',
            certPath: current?.certPath ?? '',
            keyPath: current?.keyPath ?? '',
            pfxPath: current?.pfxPath ?? '',
            passphrase: current?.passphrase ?? ''
        });
        this.editorVisible.set(true);
    }

    protected async choose(control: 'certPath' | 'keyPath' | 'pfxPath', title: string): Promise<void> {
        const file = await this.dialogs.pickFile(title);

        if (file) {
            this.form.controls[control].setValue(file);
        }
    }

    protected save(): void {
        if (this.form.invalid) {
            this.form.markAllAsTouched();

            return;
        }

        const { host, format, certPath, keyPath, pfxPath, passphrase } = this.form.getRawValue();
        const certificate: ClientCertificate = {
            host: host.trim().toLowerCase(),
            certPath: format === 'pem' ? certPath : null,
            keyPath: format === 'pem' ? keyPath : null,
            pfxPath: format === 'pfx' ? pfxPath : null,
            passphrase
        };
        const index = this.editing();

        this.certificates.update((list) => (index === null ? [...list, certificate] : list.map((item, i) => (i === index ? certificate : item))));
        this.editorVisible.set(false);
    }

    protected remove(index: number): void {
        this.certificates.update((list) => list.filter((_, i) => i !== index));
    }
}
