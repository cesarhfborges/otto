import { Component, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators, type AbstractControl, type ValidationErrors, type ValidatorFn } from '@angular/forms';
import { MAX_TIMEOUT_MS, type OttoSettings, type ThemeMode } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { DialogGateway } from '../../core/ports';
import { SettingsState } from '../../core/state/settings.state';
import { ThemeService } from '../../core/theme/theme.service';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Aceita vazio (validado em conjunto com `enabled`) ou uma URL http(s). */
const proxyUrlValidator: ValidatorFn = (control: AbstractControl<string>): ValidationErrors | null => {
    const value = control.value.trim();

    if (!value) {
        return null;
    }

    try {
        const { protocol } = new URL(value);

        return protocol === 'http:' || protocol === 'https:' ? null : { proxyProtocol: true };
    } catch {
        return { proxyUrl: true };
    }
};

const proxyRequiresUrl: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
    const { enabled, url } = group.value as { enabled: boolean; url: string };

    return enabled && !url.trim() ? { proxyUrlRequired: true } : null;
};

@Component({
    selector: 'app-settings-page',
    imports: [ReactiveFormsModule, SelectButtonModule, ToggleSwitchModule, InputNumberModule, InputTextModule, ButtonModule, MessageModule],
    templateUrl: './settings.page.html',
    host: { class: 'block' }
})
export class SettingsPage {
    private readonly settingsState = inject(SettingsState);
    private readonly dialogs = inject(DialogGateway);
    protected readonly theme = inject(ThemeService);

    protected readonly maxTimeoutMs = MAX_TIMEOUT_MS;
    protected readonly persistent = this.settingsState.persistent;
    protected readonly status = signal<SaveStatus>('idle');
    protected readonly errorMessage = signal<string | null>(null);

    protected readonly themeOptions: Array<{ label: string; value: ThemeMode; icon: string }> = [
        { label: 'Light', value: 'light', icon: 'pi pi-sun' },
        { label: 'Dark', value: 'dark', icon: 'pi pi-moon' },
        { label: 'Auto', value: 'auto', icon: 'pi pi-desktop' }
    ];

    private readonly fb = inject(FormBuilder).nonNullable;

    protected readonly form = this.fb.group({
        theme: this.fb.control<ThemeMode>('auto'),
        minimizeToTray: this.fb.control(true),
        http: this.fb.group({
            // Campos de texto salvam ao sair do campo; toggles e seletores salvam na hora.
            timeoutMs: this.fb.control(0, { validators: [Validators.required, Validators.min(0), Validators.max(MAX_TIMEOUT_MS)], updateOn: 'blur' }),
            followRedirects: this.fb.control(true),
            proxy: this.fb.group(
                {
                    enabled: this.fb.control(false),
                    url: this.fb.control('', { validators: [proxyUrlValidator], updateOn: 'blur' }),
                    bypass: this.fb.control('', { updateOn: 'blur' })
                },
                { validators: [proxyRequiresUrl] }
            ),
            ssl: this.fb.group({
                verifyCertificates: this.fb.control(true),
                caCertificatePath: this.fb.control<string | null>(null)
            })
        })
    });

    constructor() {
        // Reflete o estado do main (carga inicial e mudanças vindas do tray) sem disparar novo salvamento.
        effect(() => {
            const settings = this.settingsState.settings();

            untracked(() => {
                if (JSON.stringify(this.form.getRawValue()) !== JSON.stringify(settings)) {
                    this.form.setValue(settings, { emitEvent: false });
                }
            });
        });

        this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => void this.save());
    }

    protected controlInvalid(path: string): boolean {
        const control = this.form.get(path);

        return !!control && control.invalid && (control.dirty || control.touched);
    }

    protected get proxyErrors(): ValidationErrors | null {
        const proxy = this.form.controls.http.controls.proxy;

        return { ...proxy.errors, ...proxy.controls.url.errors };
    }

    protected async browseCertificate(): Promise<void> {
        const file = await this.dialogs.pickCertificate();

        if (file) {
            this.form.controls.http.controls.ssl.controls.caCertificatePath.setValue(file);
        }
    }

    protected clearCertificate(): void {
        this.form.controls.http.controls.ssl.controls.caCertificatePath.setValue(null);
    }

    private async save(): Promise<void> {
        if (this.form.invalid) {
            this.form.markAllAsTouched();

            return;
        }

        this.status.set('saving');

        try {
            await this.settingsState.update(this.form.getRawValue() satisfies OttoSettings);
            this.errorMessage.set(null);
            this.status.set('saved');
        } catch (error) {
            this.errorMessage.set(error instanceof Error ? error.message : String(error));
            this.status.set('error');
        }
    }
}
