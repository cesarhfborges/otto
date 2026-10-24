import type { EntityId, Environment } from '../../shared/models';
import type { IEnvironmentRepository, IIpcModule, IIpcRegistrar } from '../core/contracts';
import { parseEntityId, parseEnvironmentPatch, parseNewEnvironment, parseNullableEntityId } from '../core/validation';

/** Ambientes globais (`collectionId = null`) pertencem ao workspace ativo e são gravados no `workspace.yaml`. */
export class EnvironmentsIpcModule implements IIpcModule {
    constructor(
        private readonly environments: IEnvironmentRepository,
        private readonly activeWorkspaceId: () => EntityId,
        private readonly globalsChanged: () => Promise<void>
    ) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('environments:list', (_event, collectionId) => this.environments.findByCollection(parseNullableEntityId(collectionId, 'collectionId'), this.activeWorkspaceId()));

        ipc.handle('environments:get', (_event, id) => this.environments.findById(parseEntityId(id)));

        ipc.handle('environments:create', (_event, input) => this.afterChange(this.environments.create(parseNewEnvironment(input), this.activeWorkspaceId())));

        ipc.handle('environments:update', (_event, id, patch) => this.afterChange(this.environments.update(parseEntityId(id), parseEnvironmentPatch(patch), this.activeWorkspaceId())));

        ipc.handle('environments:delete', (_event, id) => {
            const environmentId = parseEntityId(id);
            const global = this.environments.findById(environmentId)?.collectionId === null;
            const deleted = this.environments.delete(environmentId);

            return global ? this.globalsChanged().then(() => deleted) : deleted;
        });
    }

    private async afterChange<T extends Environment | null>(environment: T): Promise<T> {
        if (environment?.collectionId === null) {
            await this.globalsChanged();
        }

        return environment;
    }
}
