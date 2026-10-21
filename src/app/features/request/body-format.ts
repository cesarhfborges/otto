import { tagEnd } from '@shared/templating';

/** Resultado de validar/formatar o corpo: o texto formatado ou a mensagem de erro. */
export type FormatResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * `{{variáveis}}` / `{{ otto.… }}` fora de strings tornariam o JSON inválido (`{"id": {{id}}}`): são
 * trocadas por strings sentinela antes do parse e restauradas depois.
 */
function protectJsonVariables(source: string): { json: string; restore: (text: string) => string } {
    const variables: string[] = [];
    let json = '';
    let inString = false;

    for (let i = 0; i < source.length; i++) {
        const char = source[i]!;

        if (inString) {
            json += char;

            if (char === '\\') {
                json += source[++i] ?? '';
            } else if (char === '"') {
                inString = false;
            }

            continue;
        }

        if (char === '"') {
            inString = true;
            json += char;
        } else if (source.startsWith('{{', i)) {
            // Mesmo critério do motor: um comando pode ter `}}` dentro de uma string.
            const end = tagEnd(source, i);

            if (end < 0) {
                json += char;
                continue;
            }

            variables.push(source.slice(i, end));
            json += `"__otto_var_${variables.length - 1}__"`;
            i = end - 1;
        } else {
            json += char;
        }
    }

    return { json, restore: (text) => text.replace(/"__otto_var_(\d+)__"/g, (_, n: string) => variables[Number(n)] ?? '') };
}

export function formatJson(source: string): FormatResult {
    if (!source.trim()) {
        return { ok: true, text: source };
    }

    const { json, restore } = protectJsonVariables(source);

    try {
        return { ok: true, text: restore(JSON.stringify(JSON.parse(json), null, 2)) };
    } catch (error) {
        return { ok: false, error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
    }
}

function xmlError(source: string): string | null {
    const document = new DOMParser().parseFromString(source, 'application/xml');
    const error = document.querySelector('parsererror');

    return error
        ? `Invalid XML: ${
              (error.textContent ?? '')
                  .split('\n')
                  .find((line) => line.trim())
                  ?.trim() ?? 'parse error'
          }`
        : null;
}

/** Indenta tags uma por linha (mantém texto, comentários e CDATA como estão). */
function indentXml(source: string): string {
    let depth = 0;

    return source
        .replace(/>\s+</g, '><')
        .replace(/></g, '>\n<')
        .split('\n')
        .map((line) => {
            const trimmed = line.trim();
            const closing = /^<\//.test(trimmed);
            const opening = /^<[^!?/][^>]*[^/]>$/.test(trimmed) || /^<[a-zA-Z][^>]*>$/.test(trimmed);
            const selfContained = /^<([^\s>]+)[^>]*>.*<\/\1>$/.test(trimmed);

            if (closing) {
                depth = Math.max(0, depth - 1);
            }

            const indented = '  '.repeat(depth) + trimmed;

            if (opening && !selfContained && !closing && !trimmed.endsWith('/>')) {
                depth++;
            }

            return indented;
        })
        .join('\n');
}

export function formatXml(source: string): FormatResult {
    if (!source.trim()) {
        return { ok: true, text: source };
    }

    const error = xmlError(source);

    return error ? { ok: false, error } : { ok: true, text: indentXml(source.trim()) };
}

/** Texto livre: remove espaços no fim das linhas e linhas vazias no final. */
export function formatText(source: string): FormatResult {
    return { ok: true, text: source.replace(/[ \t]+$/gm, '').replace(/\s+$/, '') };
}

/** Só valida (para o aviso ao vivo enquanto digita). */
export function validateBody(type: 'json' | 'xml' | 'text', source: string): string | null {
    if (!source.trim() || type === 'text') {
        return null;
    }

    if (type === 'xml') {
        return xmlError(source);
    }

    const result = formatJson(source);

    return result.ok ? null : result.error;
}
