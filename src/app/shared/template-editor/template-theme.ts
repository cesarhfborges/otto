import { EditorView } from '@codemirror/view';

/** Aparência do CodeMirror alinhada ao `pInputText` e às sobreposições do PrimeNG (tokens do tema). */
export const templateTheme = EditorView.theme({
    '&': { color: 'inherit', backgroundColor: 'transparent', fontSize: 'inherit', fontFamily: 'inherit' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.5', overflowX: 'auto', scrollbarWidth: 'none' },
    '.cm-content': { padding: '0', caretColor: 'var(--p-inputtext-color)', minHeight: '1.5em' },
    '.cm-line': { padding: '0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--p-inputtext-color)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'color-mix(in srgb, var(--p-primary-color) 28%, transparent) !important'
    },
    // Números de linha como a calha do app-code-editor.
    '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--p-text-muted-color)', borderRight: '1px solid var(--p-content-border-color)', marginRight: '0.75rem' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 0.75rem 0 0', minWidth: '2ch', textAlign: 'right' },
    '.cm-placeholder': { color: 'var(--p-inputtext-placeholder-color)' },
    '.cm-tooltip': {
        border: '1px solid var(--p-content-border-color)',
        backgroundColor: 'var(--p-content-background)',
        color: 'var(--p-text-color)',
        borderRadius: 'var(--p-content-border-radius)',
        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        fontFamily: 'var(--font-sans, inherit)',
        fontSize: '0.8125rem'
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'inherit', maxHeight: '18rem', minWidth: '20rem', maxWidth: '36rem', padding: '0.25rem' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.375rem 0.5rem', borderRadius: 'var(--p-content-border-radius)', lineHeight: '1.25rem' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--p-highlight-background)', color: 'var(--p-highlight-color)' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > completion-section': {
        display: 'block',
        padding: '0.5rem 0.5rem 0.25rem',
        border: 'none',
        color: 'var(--p-text-muted-color)',
        fontSize: '0.6875rem',
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: '0.04em'
    },
    '.cm-completionLabel': { fontFamily: 'var(--font-mono, monospace)' },
    '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700', color: 'var(--p-primary-color)' },
    '.cm-completionDetail': { marginLeft: 'auto', paddingLeft: '1rem', fontStyle: 'normal', color: 'var(--p-text-muted-color)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '16rem' },
    'li[aria-selected] .cm-completionDetail': { color: 'inherit' },
    '.cm-completionIcon': { display: 'none' },
    '.otto-completion-icon': { width: '1rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--p-text-muted-color)' },
    'li[aria-selected] .otto-completion-icon': { color: 'inherit' },
    '.cm-tooltip.cm-completionInfo': { padding: '0.5rem 0.75rem', maxWidth: '22rem', whiteSpace: 'pre-line', lineHeight: '1.4' }
});
