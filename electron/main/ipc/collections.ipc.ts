import type { ICollectionMetadataRepository, IIpcModule, IIpcRegistrar } from '../core/contracts';
import { parseCollectionPatch, parseEntityId, parseNewCollection } from '../core/validation';

export class CollectionsIpcModule implements IIpcModule {
    constructor(private readonly collections: ICollectionMetadataRepository) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('collections:list', () => this.collections.findAll());

        ipc.handle('collections:get', (_event, id) => this.collections.findById(parseEntityId(id)));

        ipc.handle('collections:create', (_event, input) => this.collections.create(parseNewCollection(input)));

        ipc.handle('collections:update', (_event, id, patch) => this.collections.update(parseEntityId(id), parseCollectionPatch(patch)));

        ipc.handle('collections:delete', (_event, id) => this.collections.delete(parseEntityId(id)));
    }
}
