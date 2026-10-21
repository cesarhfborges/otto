export interface TextSegment {
    type: 'text';
    start: number;
    end: number;
    /** Texto já sem os escapes (`\{{` → `{{`). */
    value: string;
}

export interface TagSegment {
    type: 'tag';
    start: number;
    end: number;
    /** A tag inteira, com `{{` e `}}`. */
    raw: string;
    /** Conteúdo entre `{{` e `}}`. */
    inner: string;
    innerStart: number;
}

export type Segment = TextSegment | TagSegment;

/** Fim (exclusivo) da tag que começa em `start` (`{{`), ou -1 se não fecha. Respeita strings e `{…}` aninhados. */
export function tagEnd(source: string, start: number): number {
    let quote: string | null = null;
    let depth = 0;

    for (let i = start + 2; i < source.length; i++) {
        const char = source[i]!;

        if (quote) {
            if (char === '\\') {
                i++;
            } else if (char === quote) {
                quote = null;
            }
        } else if (char === "'" || char === '"') {
            quote = char;
        } else if (char === '{') {
            depth++;
        } else if (char === '}') {
            if (depth === 0 && source[i + 1] === '}') {
                return i + 2;
            }

            depth = Math.max(0, depth - 1);
        } else if (char === '\n') {
            return -1;
        }
    }

    return -1;
}

/**
 * Divide o texto em trechos literais e tags `{{ … }}`. Síncrono e barato: roda a cada
 * tecla no editor. `\{{` é um `{{` literal; tag sem fechamento fica como texto.
 */
export function tokenize(source: string): Segment[] {
    const segments: Segment[] = [];
    let text = '';
    let textStart = 0;
    const flush = (end: number): void => {
        if (end > textStart) {
            segments.push({ type: 'text', start: textStart, end, value: text });
        }

        text = '';
    };

    for (let i = 0; i < source.length; ) {
        if (source.startsWith('\\{{', i)) {
            text += '{{';
            i += 3;
        } else if (source.startsWith('{{', i) && tagEnd(source, i) > 0) {
            const end = tagEnd(source, i);

            flush(i);
            segments.push({ type: 'tag', start: i, end, raw: source.slice(i, end), inner: source.slice(i + 2, end - 2), innerStart: i + 2 });
            textStart = i = end;
        } else {
            text += source[i];
            i++;
        }
    }

    flush(source.length);

    return segments;
}

export const hasTags = (source: string): boolean => tokenize(source).some((segment) => segment.type === 'tag');
