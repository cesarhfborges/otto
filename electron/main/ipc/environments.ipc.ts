import type { EntityId } from '../../shared/models';
import type { IEnvironmentRepository, IIpcModule, IIpcRegistrar } from '../core/contracts';
import { parseEntityId, parseEnvironmentPatch, parseNewEnvironment, parseNullableEntityId } from '../core/validation';

/** Ambientes globais (`collectionId = null`) pertencem ao workspace ativo. */
export class EnvironmentsIpcModule implements IIpcModule {
    constructor(
        private readonly environments: IEnvironmentRepository,
        private readonly activeWorkspaceId: () => EntityId
    ) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('environments:list', (_event, collectionId) => this.environments.findByCollection(parseNullableEntityId(collectionId, 'collectionId'), this.activeWorkspaceId()));

        ipc.handle('environments:get', (_event, id) => this.environments.findById(parseEntityId(id)));

        ipc.handle('environments:create', (_event, input) => this.environments.create(parseNewEnvironment(input), this.activeWorkspaceId()));

        ipc.handle('environments:update', (_event, id, patch) => this.environments.update(parseEntityId(id), parseEnvironmentPatch(patch), this.activeWorkspaceId()));

        ipc.handle('environments:delete', (_event, id) => this.environments.delete(parseEntityId(id)));
    }
}
