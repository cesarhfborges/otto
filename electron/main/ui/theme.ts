import { nativeTheme } from 'electron';
import type { ThemeMode, ThemeState } from '../../shared/models';
import type { IRendererNotifier, ISettingsService } from '../core/contracts';

/** Cores de fundo da janela antes do Angular carregar (evita flash branco no tema escuro). */
export const WINDOW_BACKGROUND = { light: '#ffffff', dark: '#09090b' } as const;

const toThemeSource = (mode: ThemeMode): 'light' | 'dark' | 'system' => (mode === 'auto' ? 'system' : mode);

/**
 * Aplica a preferência de aparência no Electron (`nativeTheme.themeSource`), o que
 * também ajusta menus nativos, diálogos e o `prefers-color-scheme` do renderer.
 * Notifica o renderer quando a preferência ou o tema do sistema mudam.
 */
export class ThemeController {
    private lastSent = '';

    constructor(
        private readonly settings: ISettingsService,
        private readonly notifier: IRendererNotifier
    ) {}

    start(): void {
        this.apply(this.settings.get().theme);
        this.settings.onChange(({ theme }) => this.apply(theme));
        nativeTheme.on('updated', () => this.publish());
    }

    state(): ThemeState {
        return { mode: this.settings.get().theme, effective: nativeTheme.shouldUseDarkColors ? 'dark' : 'light' };
    }

    get isDark(): boolean {
        return nativeTheme.shouldUseDarkColors;
    }

    private apply(mode: ThemeMode): void {
        const source = toThemeSource(mode);

        if (nativeTheme.themeSource !== source) {
            nativeTheme.themeSource = source;
        }

        this.publish();
    }

    /** `nativeTheme` pode emitir `updated` mais de uma vez para a mesma mudança; enviamos só quando o estado muda. */
    private publish(): void {
        const state = this.state();
        const key = `${state.mode}:${state.effective}`;

        if (key !== this.lastSent) {
            this.lastSent = key;
            this.notifier.notify('theme:changed', state);
        }
    }
}
