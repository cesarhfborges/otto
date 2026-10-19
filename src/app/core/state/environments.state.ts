import { inject, Injectable, signal } from '@angular/core';
import type { EntityId, Environment, EnvironmentVariable } from '@shared/models';
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

    /** Cria com nome único no escopo (`New Environment`, `New Environment 2`...). Lança o erro para a tela exibir. */
    async create(collectionId: EntityId | null, name = 'New Environment', variables: EnvironmentVariable[] = []): Promise<Environment> {
        const taken = new Set(this.list(collectionId).map((env) => env.name.toLowerCase()));
        let unique = name;

        for (let n = 2; taken.has(unique.toLowerCase()); n++) {
            unique = `${name} ${n}`;
        }

        const created = await this.gateway.create({ collectionId, name: unique, variables });

        await this.load(collectionId);

        return created;
    }

    async update(environment: Environment, changes: { name: string; variables: EnvironmentVariable[] }): Promise<Environment> {
        const updated = await this.gateway.update(environment.id, changes);

        if (!updated) {
            throw new Error('This environment no longer exists');
        }

        await this.load(environment.collectionId);

        return updated;
    }

    async remove(environment: Environment): Promise<void> {
        await this.gateway.delete(environment.id);

        // O ambiente removido deixa de ser o selecionado da coleção.
        if (environment.collectionId && this.activeFor(environment.collectionId) === environment.id) {
            this.select(environment.collectionId, null);
        }

        await this.load(environment.collectionId);
    }

    /** Ao trocar de workspace: os ambientes globais são outros. */
    reset(): void {
        this.listState.set({});
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
