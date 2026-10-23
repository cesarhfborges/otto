import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { EntityId, MockServerStatus } from '@shared/models';
import { OTTO_API } from '../bridge/otto-api.token';
import { MockGateway } from '../ports';

/** Mock servers locais em execução (um por coleção), atualizados pelos eventos do main. */
@Injectable({ providedIn: 'root' })
export class MockState {
    private readonly gateway = inject(MockGateway);
    private readonly current = signal<readonly MockServerStatus[]>([]);

    readonly servers = this.current.asReadonly();

    constructor() {
        if (inject(OTTO_API) === null) {
            return;
        }

        inject(DestroyRef).onDestroy(this.gateway.onChanged((servers) => this.current.set(servers)));
        this.gateway.list().then(
            (servers) => this.current.set(servers),
            () => undefined
        );
    }

    find(collectionId: EntityId): MockServerStatus | undefined {
        return this.current().find((server) => server.collectionId === collectionId);
    }

    async start(collectionId: EntityId, port: number): Promise<MockServerStatus> {
        const status = await this.gateway.start(collectionId, port);

        this.current.update((servers) => [...servers.filter((server) => server.collectionId !== collectionId), status]);

        return status;
    }

    async stop(collectionId: EntityId): Promise<void> {
        await this.gateway.stop(collectionId);
        this.current.update((servers) => servers.filter((server) => server.collectionId !== collectionId));
    }
}
