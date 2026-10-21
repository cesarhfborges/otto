import { computed, DestroyRef, DOCUMENT, effect, inject, Injectable, signal } from '@angular/core';
import { usePreset } from '@primeuix/themes';
import { DEFAULT_SETTINGS, type EffectiveTheme, type ThemeMode, type ThemeState } from '@shared/models';
import { ThemeGateway } from '../ports';
import { SettingsState } from '../state/settings.state';
import { CODE_THEME_PALETTES } from './code-themes';
import { buildOttoPreset } from './otto-preset';

/** Classe usada pelo PrimeNG (`darkModeSelector`) e pelos estilos do layout. */
export const DARK_CLASS = 'app-dark';

const THEME_CYCLE: readonly ThemeMode[] = ['dark', 'light', 'auto'];

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

    /** Chave do preset aplicado; começa com o `OttoPreset` registrado em `providePrimeNG`. */
    private appliedPreset = `${DEFAULT_SETTINGS.appearance.themePreset}:${DEFAULT_SETTINGS.appearance.primaryColor}:${DEFAULT_SETTINGS.appearance.surfaceColor}`;
    private readonly themeConfig = computed(
        () => {
            const { themePreset, primaryColor, surfaceColor } = this.settings.settings().appearance;

            return { themePreset, primaryColor, surfaceColor };
        },
        { equal: (a, b) => a.themePreset === b.themePreset && a.primaryColor === b.primaryColor && a.surfaceColor === b.surfaceColor }
    );

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
            const palette = CODE_THEME_PALETTES[codeTheme] ?? CODE_THEME_PALETTES.seneca;
            const style = this.document.documentElement.style;

            for (const [token, color] of Object.entries(this.isDark() ? palette.dark : palette.light)) {
                style.setProperty(`--otto-hl-${token}`, color);
            }

            style.setProperty('--otto-code-font-size', `${codeFontSize}px`);
        });

        // Estilo base, cor de destaque e superfície: troca o preset do PrimeNG em tempo de execução.
        effect(() => {
            const config = this.themeConfig();
            const key = `${config.themePreset}:${config.primaryColor}:${config.surfaceColor}`;

            if (key === this.appliedPreset) {
                return;
            }

            this.appliedPreset = key;
            buildOttoPreset(config).then(
                // Ignora resultados atrasados (Lara/Nora são carregados sob demanda).
                (preset) => key === this.appliedPreset && usePreset(preset),
                (error) => console.error('[otto] failed to load theme preset', error)
            );
        });
    }

    setMode(mode: ThemeMode): Promise<unknown> {
        return this.settings.update({ theme: mode });
    }

    /** Próximo modo no ciclo escuro → claro → automático. */
    readonly nextMode = computed<ThemeMode>(() => THEME_CYCLE[(THEME_CYCLE.indexOf(this.mode()) + 1) % THEME_CYCLE.length]);

    /** Avança no ciclo escuro → claro → automático (botão da barra de status e atalho `theme.cycle`, sem tecla padrão). */
    toggle(): Promise<unknown> {
        return this.setMode(this.nextMode());
    }
}
