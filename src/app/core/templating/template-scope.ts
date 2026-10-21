import { computed, Injectable, signal } from '@angular/core';
import type { EntityId } from '@shared/models';
import type { VariableLayer } from '@shared/templating';

/**
 * Contexto dos campos com template de uma página (coleção atual), provido no
 * `providers` do componente da página e lido por `app-otto-input` / `app-otto-textarea`.
 */
@Injectable()
export class TemplateScope {
    private readonly source = signal<{ collectionId: () => EntityId | null; requestPath: () => string | null }>({ collectionId: () => null, requestPath: () => null });
    private readonly local = signal<() => VariableLayer | null>(() => null);

    readonly collectionId = computed(() => this.source().collectionId());
    /** Requisição aberta na página (para sugerir headers/params de `otto.request`). */
    readonly requestPath = computed(() => this.source().requestPath());

    /** Variáveis em edição na página (ex.: o ambiente aberto), com prioridade sobre as salvas. */
    readonly localVariables = computed(() => this.local()());

    connectLocal(layer: () => VariableLayer | null): void {
        this.local.set(layer);
    }

    connect(collectionId: () => EntityId | null, requestPath: () => string | null = () => null): void {
        this.source.set({ collectionId, requestPath });
    }
}
