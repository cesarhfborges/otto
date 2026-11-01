// @ts-check
import eslint from '@eslint/js';
import angular from 'angular-eslint';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/** Linhas em branco em volta de declarações, blocos e `return` (estilo do projeto). */
const paddingRules = {
    'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
        { blankLine: 'any', prev: ['case', 'default'], next: 'break' },
        { blankLine: 'any', prev: 'case', next: 'case' },
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: 'block', next: '*' },
        { blankLine: 'always', prev: '*', next: 'block' },
        { blankLine: 'always', prev: 'block-like', next: '*' },
        { blankLine: 'always', prev: '*', next: 'block-like' },
        { blankLine: 'always', prev: ['import'], next: ['const', 'let', 'var'] },
        // `case` agrupados (`case 'a':` seguido de `case 'b': {`) ficam juntos.
        { blankLine: 'any', prev: 'case', next: ['case', 'default'] }
    ]
};

export default tseslint.config(
    { ignores: ['dist/**', 'release/**', 'node_modules/**', '.angular/**', 'public/**', 'docs/**'] },
    {
        // Processo main, preload e código compartilhado (Node/Electron).
        files: ['electron/**/*.ts'],
        extends: [eslint.configs.recommended, ...tseslint.configs.recommended, prettier],
        rules: {
            ...paddingRules,
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }]
        }
    },
    {
        // Renderer (Angular).
        files: ['src/**/*.ts'],
        extends: [eslint.configs.recommended, ...tseslint.configs.recommended, ...angular.configs.tsRecommended, prettier],
        processor: angular.processInlineTemplates,
        rules: {
            ...paddingRules,
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
            '@angular-eslint/component-selector': ['error', { type: 'element', prefix: 'app', style: 'kebab-case' }],
            '@angular-eslint/directive-selector': ['error', { type: 'attribute', prefix: 'app', style: 'camelCase' }],
            // Componentes do projeto não usam o sufixo `Component` (ex.: `RequestView`).
            '@angular-eslint/component-class-suffix': 'off',
            '@angular-eslint/directive-class-suffix': 'off',
            // `@HostBinding`/`@HostListener` são proibidos pelas convenções do projeto (usar `host`).
            '@angular-eslint/no-host-metadata-property': 'off',
            '@angular-eslint/prefer-standalone': 'error'
        }
    },
    {
        files: ['src/**/*.html'],
        extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
        rules: {
            '@angular-eslint/template/eqeqeq': ['error', { allowNullOrUndefined: true }],
            '@angular-eslint/template/prefer-control-flow': 'error'
        }
    },
    {
        files: ['scripts/**/*.mjs', '*.mjs'],
        extends: [eslint.configs.recommended, prettier],
        languageOptions: { globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', WebSocket: 'readonly', setTimeout: 'readonly', URL: 'readonly' } }
    }
);
