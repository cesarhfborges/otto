import { Component, computed, input } from '@angular/core';

/** Tons da paleta do PrimeNG usados nos avatares (variáveis `--p-<tom>-<nível>`). */
const ACCENTS = ['emerald', 'sky', 'violet', 'amber', 'rose', 'teal', 'indigo', 'orange'] as const;

/**
 * Mesmo nome, mesma cor: um hash curto e bem distribuído (cyrb53, 32 bits baixos) escolhe o tom, estável
 * entre sessões e máquinas. O FNV-1a com `% 8` concentrava nomes parecidos ("Collection 01", "02"...) em poucos tons.
 */
export function collectionAccent(name: string): (typeof ACCENTS)[number] {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;

    for (const char of name.trim().toLowerCase()) {
        const code = char.codePointAt(0)!;

        h1 = Math.imul(h1 ^ code, 2654435761);
        h2 = Math.imul(h2 ^ code, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return ACCENTS[(h1 >>> 0) % ACCENTS.length]!;
}

/** "Petstore API" → "PA"; "billing" → "BI"; sem letras ou números → "?". */
export function collectionInitials(name: string): string {
    const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
    const initials = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0]?.slice(0, 2) ?? '?');

    return initials.toUpperCase();
}

/**
 * Avatar da coleção: iniciais sobre a cor derivada do nome, para reconhecer a coleção de relance
 * (cards do workspace, cabeçalho e barra lateral). Decorativo: o nome sempre aparece ao lado.
 */
@Component({
    selector: 'app-collection-avatar',
    template: `{{ initials() }}`,
    host: {
        class: 'otto-collection-avatar',
        'aria-hidden': 'true',
        '[class.otto-collection-avatar-sm]': "size() === 'sm'",
        '[style.--otto-accent-100]': "'var(--p-' + accent() + '-100)'",
        '[style.--otto-accent-300]': "'var(--p-' + accent() + '-300)'",
        '[style.--otto-accent-500]': "'var(--p-' + accent() + '-500)'",
        '[style.--otto-accent-700]': "'var(--p-' + accent() + '-700)'"
    }
})
export class CollectionAvatar {
    readonly name = input.required<string>();
    /** `md` (40px) nos cards; `sm` (20px) em cabeçalhos. */
    readonly size = input<'sm' | 'md'>('md');

    protected readonly accent = computed(() => collectionAccent(this.name()));
    protected readonly initials = computed(() => collectionInitials(this.name()));
}
