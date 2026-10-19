import { Component, computed, input } from '@angular/core';
import type { HttpMethod } from '@shared/models';

const COLORS: Partial<Record<HttpMethod, string>> = {
    GET: 'var(--otto-method-get)',
    POST: 'var(--otto-method-post)',
    PUT: 'var(--otto-method-put)',
    PATCH: 'var(--otto-method-patch)',
    DELETE: 'var(--otto-method-delete)'
};

/** Abreviações para a árvore (largura fixa). */
const COMPACT_LABELS: Partial<Record<HttpMethod, string>> = { DELETE: 'DEL', OPTIONS: 'OPT', CONNECT: 'CONN' };

/** Rótulo colorido do método HTTP (cores com contraste AA nos dois temas). */
@Component({
    selector: 'app-method-badge',
    template: `{{ label() }}`,
    host: {
        class: 'inline-block shrink-0 font-semibold uppercase tracking-wide',
        '[style.font-size]': "compact() ? '0.6875rem' : null",
        '[style.color]': 'color()',
        '[style.min-width]': "compact() ? '2.75rem' : null"
    }
})
export class MethodBadge {
    readonly method = input.required<HttpMethod | null>();
    /** Versão menor e com largura fixa, para alinhar itens na árvore. */
    readonly compact = input(false);

    protected readonly label = computed(() => {
        const method = this.method();

        return method === null ? '???' : this.compact() ? (COMPACT_LABELS[method] ?? method) : method;
    });

    protected readonly color = computed(() => {
        const method = this.method();

        return method ? (COLORS[method] ?? 'var(--otto-method-other)') : 'var(--p-text-muted-color)';
    });
}
