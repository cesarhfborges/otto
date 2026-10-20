import { computed, DestroyRef, DOCUMENT, effect, inject, Injectable, signal } from '@angular/core';
import type { EffectiveTheme, ThemeMode, ThemeState } from '@shared/models';
import { ThemeGateway } from '../ports';
import { SettingsState } from '../state/settings.state';
import { CODE_THEME_PALETTES } from './code-themes';

/** Classe usada pelo PrimeNG (`darkModeSelector`) e pelos estilos do layout. */
export const DARK_CLASS = 'app-dark';

/**
 * Tema da aplicação: preferência do usuário (`light`/`dark`/`auto`) e tema efetivo.
 * No modo `auto`, o tema efetivo vem do main (`nativeTheme`) ou, fora do Electron,
 * da media query `prefers-color-scheme`.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
    private readonly settings = inject(SettingsState);
    private readonly gateway = inject(ThemeGateway);
    private readonly document = inject(DOCUMENT);
    private readonly nativeState = signal<ThemeState | null>(null);
    private readonly systemPrefersDark = signal(false);

    readonly mode = computed<ThemeMode>(() => this.settings.settings().theme);

    readonly effective = computed<EffectiveTheme>(() => {
        const mode = this.mode();

        if (mode !== 'auto') {
            return mode;
        }

        const native = this.nativeState();

        return native?.mode === 'auto' ? native.effective : this.systemPrefersDark() ? 'dark' : 'light';
    });

    readonly isDark = computed(() => this.effective() === 'dark');

    constructor() {
        const destroyRef = inject(DestroyRef);
        const media = this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');

        if (media) {
            const onChange = (event: MediaQueryListEvent) => this.systemPrefersDark.set(event.matches);

            this.systemPrefersDark.set(media.matches);
            media.addEventListener('change', onChange);
            destroyRef.onDestroy(() => media.removeEventListener('change', onChange));
        }

        destroyRef.onDestroy(this.gateway.onChanged((state) => this.nativeState.set(state)));
        this.gateway.get().then(
            (state) => this.nativeState.set(state),
            () => undefined // Fora do Electron: usa apenas a media query.
        );

        effect(() => this.document.documentElement.classList.toggle(DARK_CLASS, this.isDark()));

        // Paleta e fonte do realce de sintaxe (highlight.js) como variáveis CSS globais.
        effect(() => {
            const { codeTheme, codeFontSize } = this.settings.settings().appearance;
            const palette = CODE_THEME_PALETTES[codeTheme] ?? CODE_THEME_PALETTES.github;
            const style = this.document.documentElement.style;

            for (const [token, color] of Object.entries(this.isDark() ? palette.dark : palette.light)) {
                style.setProperty(`--otto-hl-${token}`, color);
            }

            style.setProperty('--otto-code-font-size', `${codeFontSize}px`);
        });
    }

    setMode(mode: ThemeMode): Promise<unknown> {
        return this.settings.update({ theme: mode });
    }

    /** Alterna entre claro e escuro explícitos (atalho Ctrl+Shift+D e botão do topo). */
    toggle(): Promise<unknown> {
        return this.setMode(this.isDark() ? 'light' : 'dark');
    }
}
