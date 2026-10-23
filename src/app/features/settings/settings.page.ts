import { Component, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { type AbstractControl, FormBuilder, ReactiveFormsModule, type ValidationErrors, type ValidatorFn, Validators } from '@angular/forms';
import { type AppInfo, type CodeTheme, MAX_CODE_FONT_SIZE, MAX_HISTORY_ENTRIES, MAX_TIMEOUT_MS, MIN_CODE_FONT_SIZE, type OttoSettings, PRIMARY_COLORS, type PrimaryColor, type RequestLayout, SURFACE_COLORS, type SurfaceColor, type ThemeMode, type ThemePreset } from '@shared/models';
import { Highlight } from 'ngx-highlightjs';
import { HighlightLineNumbers } from 'ngx-highlightjs/line-numbers';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { AppInfoGateway, DialogGateway } from '../../core/ports';
import { KeybindingsState } from '../../core/state/keybindings.state';
import { UpdatesState } from '../../core/state/updates.state';
import { SettingsState } from '../../core/state/settings.state';
import { ThemeService } from '../../core/theme/theme.service';
import { CODE_THEME_PALETTES } from '../../core/theme/code-themes';
import { SURFACE_PALETTES } from '../../core/theme/otto-preset';
import { KeyboardShortcutsSettings } from './keyboard-shortcuts';
import { SettingsDialog } from './settings-dialog.service';
import { DatePipe, NgOptimizedImage } from '@angular/common';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type PreferencesSection = 'general' | 'themes' | 'appearance' | 'shortcuts' | 'proxy' | 'certificates' | 'updates' | 'about';

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

const EXAMPLE = {
    id: 42,
    name: 'Otto',
    active: true,
    tags: ['api', 'client', true, 0, null],
    owner: null,
};

@Component({
    selector: 'app-settings-page',
    imports: [DatePipe, Highlight, HighlightLineNumbers, KeyboardShortcutsSettings, ReactiveFormsModule, SelectModule, SelectButtonModule, ToggleSwitchModule, InputNumberModule, InputTextModule, ButtonModule, MessageModule, NgOptimizedImage],
    templateUrl: './settings.page.html',
    styles: `
        ::ng-deep {
            .settings-dialog-custom {
                height: calc(100% - 56px) !important;
                top: 32px !important;
            }
        }
    `,
    host: { class: 'flex h-full min-h-0 w-full' }
})
export class SettingsPage {
    protected readonly theme = inject(ThemeService);
    protected readonly sections: Array<{ id: PreferencesSection; label: string; icon: string; description: string }> = [
        { id: 'general', label: 'General', icon: 'pi pi-cog', description: 'Workspaces location, application behavior and request defaults.' },
        { id: 'themes', label: 'Themes', icon: 'pi pi-palette', description: 'Color scheme, base style, accent color and surface tone used across the application.' },
        { id: 'appearance', label: 'Appearance', icon: 'pi pi-desktop', description: 'How panels are arranged in the request tab.' },
        { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: 'pi pi-key', description: 'View, change and reset the keyboard shortcuts of every command.' },
        { id: 'proxy', label: 'Proxy', icon: 'pi pi-server', description: 'Route outgoing requests through an HTTP or HTTPS proxy.' },
        { id: 'certificates', label: 'Certificates', icon: 'pi pi-shield', description: 'SSL/TLS verification and trusted certificate authorities.' },
        { id: 'updates', label: 'Updates', icon: 'pi pi-sync', description: 'New versions published on GitHub Releases, always within this installation channel (stable or beta).' },
        { id: 'about', label: 'About', icon: 'pi pi-info-circle', description: 'Version and runtime information.' }
    ];
    /** Seção inicial vinda de `SettingsDialog.open(section)`; a navegação lateral troca livremente. */
    private readonly requestedSection = inject(SettingsDialog).requestedSection;
    protected readonly section = linkedSignal<PreferencesSection>(() => this.requestedSection()?.section ?? 'general');
    protected readonly current = computed(() => this.sections.find((s) => s.id === this.section())!);
    protected readonly appInfo = signal<AppInfo | null>(null);
    protected readonly listLanguages = signal<any[]>([
        {
            label: 'English US',
            value: 'en-US',
            flag: 'https://upload.wikimedia.org/wikipedia/en/a/a4/Flag_of_the_United_States.svg'
        }
    ]);
    protected readonly maxTimeoutMs = MAX_TIMEOUT_MS;
    protected readonly maxHistoryEntries = MAX_HISTORY_ENTRIES;
    protected readonly status = signal<SaveStatus>('idle');
    private readonly keybindings = inject(KeybindingsState);
    protected readonly updates = inject(UpdatesState);
    /** Atalhos têm gravação própria: o indicador do cabeçalho segue a seção exibida. */
    protected readonly headerStatus = computed(() => (this.section() === 'shortcuts' ? this.keybindings.status() : this.status()));
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly requestLayoutOptions: Array<{ label: string; value: RequestLayout }> = [
        { label: 'Side by side (request | response)', value: 'horizontal' },
        { label: 'Stacked (request above response)', value: 'vertical' }
    ];
    protected readonly codeThemeOptions = Object.entries(CODE_THEME_PALETTES).map(([value, { label }]) => ({ label, value: value as CodeTheme }));
    protected readonly minCodeFontSize = MIN_CODE_FONT_SIZE;
    protected readonly maxCodeFontSize = MAX_CODE_FONT_SIZE;
    protected readonly codePreview = JSON.stringify(EXAMPLE, null, 2);
    protected readonly themeOptions: Array<{ label: string; value: ThemeMode; icon: string }> = [
        { label: 'Light', value: 'light', icon: 'pi pi-sun' },
        { label: 'Dark', value: 'dark', icon: 'pi pi-moon' },
        { label: 'Auto', value: 'auto', icon: 'pi pi-desktop' }
    ];
    protected readonly presetOptions: Array<{ label: string; value: ThemePreset; description: string }> = [
        { label: 'Aura', value: 'aura', description: 'Modern and rounded, focused on softness.' },
        { label: 'Lara', value: 'lara', description: 'Classic and corporate, great for dense screens.' },
        { label: 'Nora', value: 'nora', description: 'Clean and minimal, with sharper corners.' }
    ];
    protected readonly primaryColorOptions = PRIMARY_COLORS.map((value) => ({
        value,
        label: value === 'noir' ? 'Noir' : value[0].toUpperCase() + value.slice(1),
        swatch: value === 'noir' ? 'var(--p-text-color)' : `var(--p-${value}-500)`
    }));
    protected readonly surfaceColorOptions: Array<{ label: string; value: SurfaceColor | null; swatches: string[] }> = [
        // Padrão do estilo base: slate no tema claro, zinc no escuro.
        { label: 'Default', value: null, swatches: [SURFACE_PALETTES.slate[300], SURFACE_PALETTES.zinc[700]] },
        ...SURFACE_COLORS.map((value) => ({
            value,
            label: value[0].toUpperCase() + value.slice(1),
            swatches: [SURFACE_PALETTES[value][300], SURFACE_PALETTES[value][700]]
        }))
    ];
    private readonly settingsState = inject(SettingsState);
    protected readonly persistent = this.settingsState.persistent;
    /** A aceleração de hardware só é aplicada ao iniciar: avisa enquanto a preferência difere da execução atual. */
    protected readonly restartRequired = computed(() => {
        const info = this.appInfo();

        return !!info && info.hardwareAcceleration !== this.settingsState.settings().hardwareAcceleration;
    });
    private readonly appInfoGateway = inject(AppInfoGateway);
    private readonly dialogs = inject(DialogGateway);
    private readonly fb = inject(FormBuilder).nonNullable;

    protected readonly form = this.fb.group({
        theme: this.fb.control<ThemeMode>('auto'),
        showTrayIcon: this.fb.control(false),
        minimizeToTray: this.fb.control(false),
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
            themePreset: this.fb.control<ThemePreset>('aura'),
            primaryColor: this.fb.control<PrimaryColor>('emerald'),
            surfaceColor: this.fb.control<SurfaceColor | null>(null),
            requestLayout: this.fb.control<RequestLayout>('horizontal'),
            codeTheme: this.fb.control<CodeTheme>('seneca'),
            codeFontSize: this.fb.control(14, { validators: [Validators.required, Validators.min(MIN_CODE_FONT_SIZE), Validators.max(MAX_CODE_FONT_SIZE)] })
        }),
        workspaces: this.fb.group({
            baseDirectory: this.fb.control('')
        }),
        history: this.fb.group({
            maxEntries: this.fb.control(0, { validators: [Validators.required, Validators.min(0), Validators.max(MAX_HISTORY_ENTRIES)], updateOn: 'blur' })
        }),
        updates: this.fb.group({
            autoCheck: this.fb.control(true),
            autoDownload: this.fb.control(false)
        })
    });

    constructor() {
        this.appInfoGateway.info().then(
            (info) => this.appInfo.set(info),
            () => undefined
        );

        // Reflete o estado do main (carga inicial e mudanças vindas do tray) sem disparar novo salvamento.
        effect(() => {
            const settings = this.settingsState.settings();

            untracked(() => {
                if (JSON.stringify(this.form.getRawValue()) !== JSON.stringify(settings)) {
                    this.form.setValue(settings, { emitEvent: false });
                    this.syncTrayControls();
                }
            });
        });

        this.form.controls.showTrayIcon.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.syncTrayControls());
        this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => void this.save());
    }

    protected get proxyErrors(): ValidationErrors | null {
        const proxy = this.form.controls.http.controls.proxy;

        return { ...proxy.errors, ...proxy.controls.url.errors };
    }

    protected controlInvalid(path: string): boolean {
        const control = this.form.get(path);

        return !!control && control.invalid && (control.dirty || control.touched);
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

    protected relaunch(): void {
        void this.appInfoGateway.relaunch();
    }

    protected clearCertificate(): void {
        this.form.controls.http.controls.ssl.controls.caCertificatePath.setValue(null);
    }

    /** "Manter na bandeja" só faz sentido com o ícone da bandeja visível. */
    private syncTrayControls(): void {
        const minimizeToTray = this.form.controls.minimizeToTray;

        if (this.form.controls.showTrayIcon.value) {
            minimizeToTray.enable({ emitEvent: false });
        } else {
            minimizeToTray.disable({ emitEvent: false });
        }
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
