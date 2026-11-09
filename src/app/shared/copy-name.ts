/**
 * Nome sugerido para a cópia: "<nome> Copy" e, se já existir, "<nome> Copy 2", "<nome> Copy 3"...
 * A comparação ignora maiúsculas. Duplicar uma cópia acrescenta outro sufixo ("API Copy" → "API Copy Copy").
 */
export function copyName(name: string, taken: Iterable<string>): string {
    const used = new Set([...taken].map((value) => value.trim().toLowerCase()));
    const base = `${name.trim()} Copy`;
    let candidate = base;

    for (let n = 2; used.has(candidate.toLowerCase()); n++) {
        candidate = `${base} ${n}`;
    }

    return candidate;
}
