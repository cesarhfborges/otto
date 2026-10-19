import type { IEnvironmentRepository, IIpcModule, IIpcRegistrar } from '../core/contracts';
import { parseEntityId, parseEnvironmentPatch, parseNewEnvironment, parseNullableEntityId } from '../core/validation';

export class EnvironmentsIpcModule implements IIpcModule {
    constructor(private readonly environments: IEnvironmentRepository) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('environments:list', (_event, collectionId) => this.environments.findByCollection(parseNullableEntityId(collectionId, 'collectionId')));

        ipc.handle('environments:get', (_event, id) => this.environments.findById(parseEntityId(id)));

        ipc.handle('environments:create', (_event, input) => this.environments.create(parseNewEnvironment(input)));

        ipc.handle('environments:update', (_event, id, patch) => this.environments.update(parseEntityId(id), parseEnvironmentPatch(patch)));

        ipc.handle('environments:delete', (_event, id) => this.environments.delete(parseEntityId(id)));
    }
}
