/** Nomes reservados no Windows que não podem ser usados como nome de arquivo. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/;

/** `"Créer usuário #1"` → `"creer-usuario-1"`: seguro em qualquer sistema de arquivos e estável no Git. */
export function slugify(name: string, fallback = 'untitled'): string {
    const slug = name
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
        .replace(/-+$/, '');

    if (!slug) {
        return fallback;
    }

    return WINDOWS_RESERVED.test(slug) ? `${slug}-1` : slug;
}
