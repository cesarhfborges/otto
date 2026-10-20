import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import java from 'highlight.js/lib/languages/java';

hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('java', java);

export type HighlightLanguage = 'json' | 'xml';

/** Acima disso o realce custa mais do que ajuda: o texto é só escapado. */
const MAX_HIGHLIGHT_CHARS = 300_000;

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML seguro (o highlight.js escapa o conteúdo) com as classes `hljs-*` de cada token. */
export function highlightCode(code: string, language: HighlightLanguage | null): string {
    if (!language || code.length > MAX_HIGHLIGHT_CHARS) {
        return escapeHtml(code);
    }

    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
}
