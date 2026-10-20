import type { CodeTheme } from '@shared/models';

/** Cores dos tokens do highlight.js; viram as variáveis `--otto-hl-*` usadas em styles.scss. */
export interface CodePalette {
    key: string;
    string: string;
    number: string;
    literal: string;
    tag: string;
    comment: string;
}

/**
 * Cada paleta tem uma variante para o tema claro e outra para o escuro, ambas com
 * contraste AA sobre as superfícies do app (o fundo dos editores não muda).
 */
export const CODE_THEME_PALETTES: Record<CodeTheme, { label: string; light: CodePalette; dark: CodePalette }> = {
    github: {
        label: 'GitHub',
        light: { key: '#0550ae', string: '#0a3069', number: '#0550ae', literal: '#cf222e', tag: '#116329', comment: '#57606a' },
        dark: { key: '#79c0ff', string: '#a5d6ff', number: '#79c0ff', literal: '#ff7b72', tag: '#7ee787', comment: '#8b949e' }
    },
    'atom-one': {
        label: 'Atom One',
        light: { key: '#a626a4', string: '#3f7d2e', number: '#986801', literal: '#0e6fb5', tag: '#c0392b', comment: '#696c77' },
        dark: { key: '#e06c75', string: '#98c379', number: '#d19a66', literal: '#56b6c2', tag: '#e06c75', comment: '#8b929e' }
    },
    monokai: {
        label: 'Monokai',
        light: { key: '#c7254e', string: '#7a6a00', number: '#7c4dcc', literal: '#7c4dcc', tag: '#c7254e', comment: '#6e6a5e' },
        dark: { key: '#f92672', string: '#e6db74', number: '#ae81ff', literal: '#ae81ff', tag: '#f92672', comment: '#a59f85' }
    },
    dracula: {
        label: 'Dracula',
        light: { key: '#7c3aed', string: '#9a6700', number: '#6d28d9', literal: '#be185d', tag: '#be185d', comment: '#5b6178' },
        dark: { key: '#8be9fd', string: '#f1fa8c', number: '#bd93f9', literal: '#ff79c6', tag: '#ff79c6', comment: '#9aa5ce' }
    },
    solarized: {
        label: 'Solarized',
        light: { key: '#1f6fae', string: '#5f6e00', number: '#a53a6d', literal: '#a43c19', tag: '#1f6fae', comment: '#5b6e74' },
        dark: { key: '#5aa9e6', string: '#a8b832', number: '#e07aa8', literal: '#f07a52', tag: '#5aa9e6', comment: '#93a1a1' }
    },
    nord: {
        label: 'Nord',
        light: { key: '#3b6c8e', string: '#4c7a32', number: '#8a4f7d', literal: '#2e6f78', tag: '#3b6c8e', comment: '#5e677a' },
        dark: { key: '#88c0d0', string: '#a3be8c', number: '#b48ead', literal: '#81a1c1', tag: '#81a1c1', comment: '#9aa3b5' }
    }
};
