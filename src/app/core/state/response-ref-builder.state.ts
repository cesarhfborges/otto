import { Injectable, signal } from '@angular/core';
import type { EntityId } from '@shared/models';

export interface ResponseRefRequest {
    collectionId: EntityId;
    /** Requisição em edição (não pode referenciar a si mesma); `null` fora de uma requisição. */
    currentPath: string | null;
    /** Expressão atual da tag (edição de um chip existente), ou `null` para uma nova. */
    initial: string | null;
    resolve: (expression: string | null) => void;
}

/**
 * Construtor visual de `{{ otto.request(…).response… }}` (encadear requisições sem script).
 * Os campos de template pedem a expressão; o diálogo do shell responde.
 */
@Injectable({ providedIn: 'root' })
export class ResponseRefBuilderState {
    private readonly pendingState = signal<ResponseRefRequest | null>(null);

    readonly pending = this.pendingState.asReadonly();

    /** Abre o diálogo; resolve com a expressão (sem `{{ }}`) ou `null` se cancelado. */
    open(collectionId: EntityId, currentPath: string | null, initial: string | null = null): Promise<string | null> {
        this.pendingState()?.resolve(null);

        return new Promise((resolve) => this.pendingState.set({ collectionId, currentPath, initial, resolve }));
    }

    finish(expression: string | null): void {
        const pending = this.pendingState();

        this.pendingState.set(null);
        pending?.resolve(expression);
    }
}
