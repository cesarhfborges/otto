import type { ICollectionMetadataRepository, IIpcModule, IIpcRegistrar, IRendererNotifier } from '../core/contracts';
import { parseCollectionPatch, parseCollectionPath, parseEntityId, parseEntryName, parseNewCollection } from '../core/validation';
import type { CollectionService } from '../services/collections/collection.service';

/** Metadados (banco) e ciclo de vida (abrir/criar/fechar) das coleções. */
export class CollectionsIpcModule implements IIpcModule {
    constructor(
        private readonly collections: ICollectionMetadataRepository,
        private readonly service: CollectionService,
        private readonly notifier: IRendererNotifier
    ) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('collections:list', () => this.collections.findAll());

        ipc.handle('collections:get', (_event, id) => this.collections.findById(parseEntityId(id)));

        ipc.handle('collections:create', (_event, input) => this.collections.create(parseNewCollection(input)));

        ipc.handle('collections:update', (_event, id, patch) => this.collections.update(parseEntityId(id), parseCollectionPatch(patch)));

        ipc.handle('collections:delete', (_event, rawId) => {
            const id = parseEntityId(rawId);

            this.service.close(id);

            return this.collections.delete(id);
        });

        ipc.handle('collections:open', (_event, directory) => this.service.open(parseCollectionPath(directory, 'directory')));

        ipc.handle('collections:new', (_event, parent, name) => this.service.create(parseCollectionPath(parent, 'parentDirectory'), parseEntryName(name)));

        ipc.handle('collections:close', (_event, id) => this.service.close(parseEntityId(id)));

        ipc.handle('collections:tree', (_event, id) => this.service.tree(parseEntityId(id)));

        this.service.onChanged((collectionId) => this.notifier.notify('collections:changed', { collectionId }));
    }
}
