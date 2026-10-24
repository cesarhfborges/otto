export type DiffLine =
    | { kind: 'same' | 'removed' | 'added'; text: string; /** Número da linha no texto antigo e no novo. */ before: number | null; after: number | null }
    /** Trecho igual omitido (fora do contexto das mudanças). */
    | { kind: 'skip'; count: number };

/** Acima disso (linhas × linhas do trecho diferente) o meio vira "removido + adicionado" sem LCS. */
const MAX_LCS_CELLS = 4_000_000;

/** Diff por linhas (LCS) com `context` linhas iguais em volta de cada mudança. */
export function diffLines(before: string, after: string, context = 3): DiffLine[] {
    const a = before.split('\n');
    const b = after.split('\n');
    let start = 0;

    while (start < a.length && start < b.length && a[start] === b[start]) {
        start++;
    }

    let endA = a.length;
    let endB = b.length;

    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA--;
        endB--;
    }

    const lines: Array<Exclude<DiffLine, { kind: 'skip' }>> = [];

    for (let i = 0; i < start; i++) {
        lines.push({ kind: 'same', text: a[i]!, before: i + 1, after: i + 1 });
    }

    const midA = a.slice(start, endA);
    const midB = b.slice(start, endB);

    if (midA.length * midB.length > MAX_LCS_CELLS) {
        midA.forEach((text, i) => lines.push({ kind: 'removed', text, before: start + i + 1, after: null }));
        midB.forEach((text, j) => lines.push({ kind: 'added', text, before: null, after: start + j + 1 }));
    } else {
        // Tabela de LCS do fim para o começo; depois percorre do começo.
        const n = midA.length;
        const m = midB.length;
        const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));

        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                table[i]![j] = midA[i] === midB[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
            }
        }

        let i = 0;
        let j = 0;

        while (i < n || j < m) {
            if (i < n && j < m && midA[i] === midB[j]) {
                lines.push({ kind: 'same', text: midA[i]!, before: start + i + 1, after: start + j + 1 });
                i++;
                j++;
            } else if (j < m && (i === n || table[i]![j + 1]! >= table[i + 1]![j]!)) {
                lines.push({ kind: 'added', text: midB[j]!, before: null, after: start + j + 1 });
                j++;
            } else {
                lines.push({ kind: 'removed', text: midA[i]!, before: start + i + 1, after: null });
                i++;
            }
        }
    }

    for (let k = 0; k < a.length - endA; k++) {
        lines.push({ kind: 'same', text: a[endA + k]!, before: endA + k + 1, after: endB + k + 1 });
    }

    return collapse(lines, context);
}

function collapse(lines: Array<Exclude<DiffLine, { kind: 'skip' }>>, context: number): DiffLine[] {
    const changed = lines.map((line) => line.kind !== 'same');
    const keep = changed.map((_, i) => changed.slice(Math.max(0, i - context), i + context + 1).some(Boolean));
    const result: DiffLine[] = [];
    let skipped = 0;

    lines.forEach((line, i) => {
        if (keep[i]) {
            if (skipped) {
                result.push({ kind: 'skip', count: skipped });
                skipped = 0;
            }

            result.push(line);
        } else {
            skipped++;
        }
    });

    if (skipped) {
        result.push({ kind: 'skip', count: skipped });
    }

    return result;
}

/** JSON formatado (chaves em ordem) para o diff não acusar só reordenação; outros textos como vieram. */
export function normalizeForDiff(text: string | null): string {
    if (text === null) {
        return '';
    }

    try {
        const sortKeys = (value: unknown): unknown =>
            Array.isArray(value)
                ? value.map(sortKeys)
                : value !== null && typeof value === 'object'
                  ? Object.fromEntries(
                        Object.keys(value)
                            .sort()
                            .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])])
                    )
                  : value;

        return JSON.stringify(sortKeys(JSON.parse(text)), null, 2);
    } catch {
        return text;
    }
}
