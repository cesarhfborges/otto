import { DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import type { EntityId, OpenApiConfig, OpenApiStatus } from '@shared/models';
import { ipcErrorMessage } from '../bridge/ipc-error';
import { OpenApiGateway } from '../ports';
import { CollectionsState } from './collections.state';

/**
 * Sincronização OpenAPI das coleções abertas: guarda o último status de cada uma e
 * faz a verificação automática no intervalo configurado (enquanto a coleção está aberta).
 */
@Injectable({ providedIn: 'root' })
export class OpenApiState {
    private readonly gateway = inject(OpenApiGateway);
    private readonly collections = inject(CollectionsState);
    private readonly statuses = signal<ReadonlyMap<EntityId, OpenApiStatus>>(new Map());
    private readonly busyIds = signal<ReadonlySet<EntityId>>(new Set());
    private readonly timers = new Map<EntityId, { key: string; timer: ReturnType<typeof setInterval> }>();

    constructor() {
        // Agenda/cancela verificações conforme as coleções abertas e suas configurações.
        effect(() => {
            const linked = this.collections
                .opened()
                .filter((collection) => collection.manifest.openapi?.autoCheck)
                .map((collection) => ({ id: collection.metadata.id, config: collection.manifest.openapi! }));

            untracked(() => this.schedule(linked));
        });

        inject(DestroyRef).onDestroy(() => this.schedule([]));
    }

    status(collectionId: EntityId): OpenApiStatus | null {
        return this.statuses().get(collectionId) ?? null;
    }

    isBusy(collectionId: EntityId): boolean {
        return this.busyIds().has(collectionId);
    }

    /** Atualizações do spec pendentes (indicador no cabeçalho da coleção). */
    pendingUpdates(collectionId: EntityId): number {
        return this.status(collectionId)?.specUpdates.length ?? 0;
    }

    /** `refresh` busca o spec de novo; sem ele usa a última verificação (ou busca, se nunca verificou). */
    async load(collectionId: EntityId, refresh = false): Promise<void> {
        await this.run(collectionId, () => this.gateway.status(collectionId, refresh));
    }

    /** Lança o erro para o diálogo de configuração exibir. */
    async connect(collectionId: EntityId, config: OpenApiConfig): Promise<void> {
        this.store(collectionId, await this.gateway.connect(collectionId, config));
        await this.collections.refresh(collectionId);
    }

    async disconnect(collectionId: EntityId): Promise<void> {
        await this.gateway.disconnect(collectionId);
        await this.collections.refresh(collectionId);
        await this.load(collectionId);
    }

    spec(collectionId: EntityId): Promise<string> {
        return this.gateway.spec(collectionId);
    }

    async sync(collectionId: EntityId, keys: string[]): Promise<void> {
        await this.run(collectionId, () => this.gateway.sync(collectionId, keys), true);
    }

    async revert(collectionId: EntityId, keys: string[]): Promise<void> {
        await this.run(collectionId, () => this.gateway.revert(collectionId, keys), true);
    }

    private async run(collectionId: EntityId, action: () => Promise<OpenApiStatus>, rethrow = false): Promise<void> {
        this.busyIds.update((ids) => new Set(ids).add(collectionId));

        try {
            this.store(collectionId, await action());
        } catch (error) {
            if (rethrow) {
                throw error;
            }

            // Falha de IPC/validação: aparece no painel como erro do spec.
            const current = this.status(collectionId);

            if (current) {
                this.store(collectionId, { ...current, error: ipcErrorMessage(error) });
            }
        } finally {
            this.busyIds.update((ids) => {
                const next = new Set(ids);

                next.delete(collectionId);

                return next;
            });
        }
    }

    private store(collectionId: EntityId, status: OpenApiStatus): void {
        this.statuses.update((map) => new Map(map).set(collectionId, status));
    }

    private schedule(linked: Array<{ id: EntityId; config: OpenApiConfig }>): void {
        const wanted = new Map(linked.map(({ id, config }) => [id, `${config.source.type}:${config.source.location}:${config.intervalMinutes}`]));

        for (const [id, entry] of this.timers) {
            if (wanted.get(id) !== entry.key) {
                clearInterval(entry.timer);
                this.timers.delete(id);
            }
        }

        for (const { id, config } of linked) {
            if (!this.timers.has(id)) {
                const timer = setInterval(() => void this.load(id, true), config.intervalMinutes * 60_000);

                this.timers.set(id, { key: wanted.get(id)!, timer });
                // Primeira verificação ao abrir a coleção.
                void this.load(id, true);
            }
        }
    }
}
