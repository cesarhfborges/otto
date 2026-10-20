import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators, type AbstractControl, type ValidationErrors, type ValidatorFn } from '@angular/forms';
import { MAX_HISTORY_ENTRIES, MAX_TIMEOUT_MS, type AppInfo, type OttoSettings, type ThemeMode, type RequestLayout } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { AppInfoGateway, DialogGateway } from '../../core/ports';
import { SettingsState } from '../../core/state/settings.state';
import { ThemeService } from '../../core/theme/theme.service';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type PreferencesSection = 'general' | 'themes' | 'appearance' | 'proxy' | 'certificates' | 'about';

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
    imports: [ReactiveFormsModule, SelectModule, SelectButtonModule, ToggleSwitchModule, InputNumberModule, InputTextModule, ButtonModule, MessageModule],
    templateUrl: './settings.page.html',
    styles: `
        ::ng-deep {
            .settings-dialog-custom {
                height: calc(100% - 56px)!important;
                top: 32px!important;
            }
        }
    `,
    host: { class: 'flex h-full min-h-0 w-full' }
})
export class SettingsPage {
    private readonly settingsState = inject(SettingsState);
    private readonly dialogs = inject(DialogGateway);
    protected readonly theme = inject(ThemeService);

    protected readonly sections: Array<{ id: PreferencesSection; label: string; icon: string; description: string }> = [
        { id: 'general', label: 'General', icon: 'pi pi-cog', description: 'Workspaces location, application behavior and request defaults.' },
        { id: 'themes', label: 'Themes', icon: 'pi pi-palette', description: 'Color scheme used across the application.' },
        { id: 'appearance', label: 'Appearance', icon: 'pi pi-desktop', description: 'How panels are arranged in the request tab.' },
        { id: 'proxy', label: 'Proxy', icon: 'pi pi-server', description: 'Route outgoing requests through an HTTP or HTTPS proxy.' },
        { id: 'certificates', label: 'Certificates', icon: 'pi pi-shield', description: 'SSL/TLS verification and trusted certificate authorities.' },
        { id: 'about', label: 'About', icon: 'pi pi-info-circle', description: 'Version and runtime information.' }
    ];

    protected readonly section = signal<PreferencesSection>('general');
    protected readonly current = computed(() => this.sections.find((s) => s.id === this.section())!);
    protected readonly appInfo = signal<AppInfo | null>(null);
    protected readonly maxTimeoutMs = MAX_TIMEOUT_MS;
    protected readonly maxHistoryEntries = MAX_HISTORY_ENTRIES;
    protected readonly persistent = this.settingsState.persistent;
    protected readonly status = signal<SaveStatus>('idle');
    protected readonly errorMessage = signal<string | null>(null);

    protected readonly requestLayoutOptions: Array<{ label: string; value: RequestLayout }> = [
        { label: 'Side by side (request | response)', value: 'horizontal' },
        { label: 'Stacked (request above response)', value: 'vertical' }
    ];

    protected readonly themeOptions: Array<{ label: string; value: ThemeMode; icon: string }> = [
        { label: 'Light', value: 'light', icon: 'pi pi-sun' },
        { label: 'Dark', value: 'dark', icon: 'pi pi-moon' },
        { label: 'Auto', value: 'auto', icon: 'pi pi-desktop' }
    ];

    private readonly fb = inject(FormBuilder).nonNullable;

    protected readonly form = this.fb.group({
        theme: this.fb.control<ThemeMode>('auto'),
        minimizeToTray: this.fb.control(true),
        hardwareAcceleration: this.fb.control(true),
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
        }),
        appearance: this.fb.group({
            requestLayout: this.fb.control<RequestLayout>('horizontal')
        }),
        workspaces: this.fb.group({
            baseDirectory: this.fb.control('')
        }),
        history: this.fb.group({
            maxEntries: this.fb.control(0, { validators: [Validators.required, Validators.min(0), Validators.max(MAX_HISTORY_ENTRIES)], updateOn: 'blur' })
        })
    });

    constructor() {
        inject(AppInfoGateway)
            .info()
            .then(
                (info) => this.appInfo.set(info),
                () => undefined
            );

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

    protected async browseBaseDirectory(): Promise<void> {
        const control = this.form.controls.workspaces.controls.baseDirectory;
        const folder = await this.dialogs.chooseBaseDirectory(control.value || this.appInfo()?.defaultBaseDirectory);

        if (folder) {
            control.setValue(folder);
        }
    }

    protected resetBaseDirectory(): void {
        this.form.controls.workspaces.controls.baseDirectory.setValue('');
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
