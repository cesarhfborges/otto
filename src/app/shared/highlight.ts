/** Linguagens registradas em `provideHighlightOptions` (app.config.ts). */
export type HighlightLanguage = 'json' | 'xml' | 'plaintext';

/** Acima disso o realce custa mais do que ajuda: o texto é exibido sem realce. */
const MAX_HIGHLIGHT_CHARS = 300_000;

/** Linguagem a usar na diretiva `[highlight]` do ngx-highlightjs, ou `null` para texto puro. */
export function highlightLanguageFor(code: string, language: HighlightLanguage | null): HighlightLanguage | null {
    return code.length > MAX_HIGHLIGHT_CHARS ? null : language;
}
