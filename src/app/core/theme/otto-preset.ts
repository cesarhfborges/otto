import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';
import type { Preset } from '@primeuix/themes/types';
import { type AppearanceSettings, DEFAULT_SETTINGS, type PrimaryColor, type SurfaceColor, type ThemePreset } from '@shared/models';

/**
 * Ajustes sobre o Aura para atingir contraste WCAG AA (4.5:1).
 * O Aura usa surface.500 sobre surface.100 (4.34:1) nas opções não selecionadas do SelectButton.
 */
const ACCESSIBLE_TOKENS = {
    components: {
        togglebutton: {
            colorScheme: {
                light: {
                    root: { color: '{surface.600}' },
                    icon: { color: '{surface.600}' }
                }
            }
        },
        // Botões vermelhos sem fundo (Delete): red.500 sobre branco dá 3.8:1; 700 passa de 6:1.
        button: {
            colorScheme: {
                light: {
                    text: { danger: { color: '{red.700}' } },
                    outlined: { danger: { color: '{red.700}', borderColor: '{red.300}' } }
                }
            }
        },
        // Texto das mensagens no tema claro: o Aura usa tons 600 sobre fundo 50 (red 4.44:1, green ~3:1, yellow ~2.8:1).
        message: {
            colorScheme: {
                light: {
                    info: { color: '{blue.700}' },
                    success: { color: '{green.700}' },
                    warn: { color: '{yellow.800}' },
                    error: { color: '{red.700}' }
                }
            }
        },
        splitter: {
            colorScheme: {
                light: {
                    gutter: {
                        background: '{surface.200}'
                    },
                    handle: {
                        background: '{surface.400}',
                        size: '3rem',
                        borderRadius: '2rem'
                    }
                },
                dark: {
                    gutter: {
                        background: '{surface.800}'
                    },
                    handle: {
                        background: '{surface.600}',
                        size: '3rem',
                        borderRadius: '2rem'
                    }
                }
            }
        },
        toggleswitch: {
            handle: {
                size: 'calc(1rem + 1px)'
            },
            root: {
                // height: 'calc(100% + 1 px)'
            }
            // colorScheme: {
            //     light: {
            //         height: 'calc(100% + 1 px)'
            //     }
            // }
        }
    }
};

/** Densidade de aplicativo desktop (estilo Bruno/VS Code): árvore e abas compactas. */
const DENSITY_TOKENS = {
    components: {
        tree: {
            root: { padding: '0.25rem 0.375rem', gap: '1px', indent: '0.875rem' },
            node: { padding: '0.1875rem 0.375rem', gap: '0.25rem' },
            nodeToggleButton: { size: '1.25rem' }
        },
        tabs: {
            // Sub-abas sobre a área principal (sem "cartão" próprio), como no Bruno.
            tablist: { background: 'transparent' },
            tab: { padding: '0.5rem 0.875rem', fontWeight: '500' },
            tabpanel: { padding: '0.75rem 0', background: 'transparent' }
        }
    }
};

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

type Palette = Record<0 | (typeof SHADES)[number], string>;

/** Paletas de superfície (as mesmas do configurador do PrimeNG). */
export const SURFACE_PALETTES: Readonly<Record<SurfaceColor, Palette>> = {
    slate: { 0: '#ffffff', 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a', 950: '#020617' },
    gray: { 0: '#ffffff', 50: '#f9fafb', 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5db', 400: '#9ca3af', 500: '#6b7280', 600: '#4b5563', 700: '#374151', 800: '#1f2937', 900: '#111827', 950: '#030712' },
    zinc: { 0: '#ffffff', 50: '#fafafa', 100: '#f4f4f5', 200: '#e4e4e7', 300: '#d4d4d8', 400: '#a1a1aa', 500: '#71717a', 600: '#52525b', 700: '#3f3f46', 800: '#27272a', 900: '#18181b', 950: '#09090b' },
    neutral: { 0: '#ffffff', 50: '#fafafa', 100: '#f5f5f5', 200: '#e5e5e5', 300: '#d4d4d4', 400: '#a3a3a3', 500: '#737373', 600: '#525252', 700: '#404040', 800: '#262626', 900: '#171717', 950: '#0a0a0a' },
    stone: { 0: '#ffffff', 50: '#fafaf9', 100: '#f5f5f4', 200: '#e7e5e4', 300: '#d6d3d1', 400: '#a8a29e', 500: '#78716c', 600: '#57534e', 700: '#44403c', 800: '#292524', 900: '#1c1917', 950: '#0c0a09' },
    soho: { 0: '#ffffff', 50: '#ececec', 100: '#dedfdf', 200: '#c4c4c6', 300: '#adaeb0', 400: '#97979b', 500: '#7f8084', 600: '#6a6b70', 700: '#55565b', 800: '#3f4046', 900: '#2c2c34', 950: '#16161d' },
    viva: { 0: '#ffffff', 50: '#f3f3f3', 100: '#e7e7e8', 200: '#cfd0d0', 300: '#b7b8b9', 400: '#9fa1a1', 500: '#87898a', 600: '#6e7173', 700: '#565a5b', 800: '#3e4244', 900: '#262b2c', 950: '#0e1315' },
    ocean: { 0: '#ffffff', 50: '#fbfcfc', 100: '#f7f9f8', 200: '#eff3f2', 300: '#dadedd', 400: '#b1b7b6', 500: '#828787', 600: '#5f7274', 700: '#415b61', 800: '#29444e', 900: '#183240', 950: '#0c1920' }
};

const BASE_PRESETS: Readonly<Record<ThemePreset, () => Promise<Preset>>> = {
    aura: () => Promise.resolve(Aura),
    lara: () => import('@primeuix/themes/lara').then((m) => m.default),
    nora: () => import('@primeuix/themes/nora').then((m) => m.default)
};

const shadesOf = (color: string) => Object.fromEntries(SHADES.map((shade) => [shade, `{${color}.${shade}}`]));

/**
 * Tokens da cor de destaque. No tema claro o texto em `primary.color` (abas ativas, links)
 * usa o tom 700: o 500 fica abaixo de 4.5:1 sobre branco na maioria das paletas.
 */
function primaryTokens(primary: PrimaryColor, preset: ThemePreset) {
    if (primary === 'noir') {
        return {
            semantic: {
                primary: shadesOf('surface'),
                colorScheme: {
                    light: {
                        primary: { color: '{primary.950}', contrastColor: '#ffffff', hoverColor: '{primary.800}', activeColor: '{primary.700}' },
                        highlight: { background: '{primary.950}', focusBackground: '{primary.700}', color: '#ffffff', focusColor: '#ffffff' }
                    },
                    dark: {
                        primary: { color: '{primary.50}', contrastColor: '{primary.950}', hoverColor: '{primary.200}', activeColor: '{primary.300}' },
                        highlight: { background: '{primary.50}', focusBackground: '{primary.300}', color: '{primary.950}', focusColor: '{primary.950}' }
                    }
                }
            }
        };
    }

    // Nora destaca a seleção com fundo sólido; Aura e Lara com fundo suave.
    const highlight =
        preset === 'nora'
            ? {
                  light: { background: '{primary.700}', focusBackground: '{primary.800}', color: '#ffffff', focusColor: '#ffffff' },
                  dark: { background: '{primary.400}', focusBackground: '{primary.300}', color: '{surface.900}', focusColor: '{surface.900}' }
              }
            : {
                  light: { background: '{primary.50}', focusBackground: '{primary.100}', color: '{primary.700}', focusColor: '{primary.800}' },
                  dark: {
                      background: 'color-mix(in srgb, {primary.400}, transparent 84%)',
                      focusBackground: 'color-mix(in srgb, {primary.400}, transparent 76%)',
                      color: 'rgba(255,255,255,.87)',
                      focusColor: 'rgba(255,255,255,.87)'
                  }
              };

    return {
        semantic: {
            primary: shadesOf(primary),
            colorScheme: {
                light: {
                    primary: { color: '{primary.700}', contrastColor: '#ffffff', hoverColor: '{primary.800}', activeColor: '{primary.900}' },
                    highlight: highlight.light
                },
                dark: {
                    primary: { color: '{primary.400}', contrastColor: '{surface.900}', hoverColor: '{primary.300}', activeColor: '{primary.200}' },
                    highlight: highlight.dark
                }
            }
        }
    };
}

function surfaceTokens(surface: SurfaceColor | null) {
    if (!surface) {
        return {};
    }

    const palette = SURFACE_PALETTES[surface];

    return { semantic: { colorScheme: { light: { surface: palette }, dark: { surface: palette } } } };
}

type ThemeConfig = Pick<AppearanceSettings, 'themePreset' | 'primaryColor' | 'surfaceColor'>;

function composePreset(base: Preset, { themePreset, primaryColor, surfaceColor }: ThemeConfig): Preset {
    return definePreset(base, primaryTokens(primaryColor, themePreset), surfaceTokens(surfaceColor), ACCESSIBLE_TOKENS, DENSITY_TOKENS);
}

/** Preset completo do Otto para o estilo base, cor de destaque e superfície escolhidos. */
export async function buildOttoPreset(config: ThemeConfig): Promise<Preset> {
    return composePreset(await BASE_PRESETS[config.themePreset](), config);
}

/** Preset inicial (antes de as preferências carregarem): Aura com os valores padrão. */
export const OttoPreset = composePreset(Aura, DEFAULT_SETTINGS.appearance);
