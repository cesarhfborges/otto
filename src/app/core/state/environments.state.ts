import { inject, Injectable, signal } from '@angular/core';
import type { EntityId, Environment } from '@shared/models';
import { EnvironmentsGateway } from '../ports';

const ACTIVE_KEY = 'otto.activeEnvironments';
/** Chave usada para os ambientes globais (sem coleção). */
const GLOBAL = '';

function readActive(): Record<string, EntityId | null> {
    try {
        return JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? '{}') as Record<string, EntityId | null>;
    } catch {
        return {};
    }
}

/**
 * Ambientes por coleção (e globais) e o ambiente selecionado em cada coleção.
 * A seleção é uma preferência de interface local; os ambientes vivem no SQLite.
 */
@Injectable({ providedIn: 'root' })
export class EnvironmentsState {
    private readonly gateway = inject(EnvironmentsGateway);
    private readonly listState = signal<Record<string, Environment[]>>({});
    private readonly activeState = signal<Record<string, EntityId | null>>(readActive());

    readonly lists = this.listState.asReadonly();
    readonly active = this.activeState.asReadonly();

    list(collectionId: EntityId | null): Environment[] {
        return this.listState()[collectionId ?? GLOBAL] ?? [];
    }

    async load(collectionId: EntityId | null): Promise<void> {
        try {
            const environments = await this.gateway.list(collectionId);

            this.listState.update((lists) => ({ ...lists, [collectionId ?? GLOBAL]: environments }));
        } catch {
            // Fora do Electron não há ambientes.
        }
    }

    activeFor(collectionId: EntityId): EntityId | null {
        return this.activeState()[collectionId] ?? null;
    }

    select(collectionId: EntityId, environmentId: EntityId | null): void {
        this.activeState.update((map) => ({ ...map, [collectionId]: environmentId }));

        try {
            localStorage.setItem(ACTIVE_KEY, JSON.stringify(this.activeState()));
        } catch {
            // Sem armazenamento: a seleção vale só nesta sessão.
        }
    }
}
