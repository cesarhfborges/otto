import type { ICollectionMetadataRepository, IIpcModule, IIpcRegistrar, IRendererNotifier } from '../core/contracts';
import { parseCollectionPatch, parseCollectionPath, parseEntityId, parseEntryName, parseNewCollection, parseKeyValues, requireRecord, requireString } from '../core/validation';
import type { CollectionService } from '../services/collections/collection.service';
import type { WorkspaceService } from '../services/workspaces/workspace.service';
import { parseArchivePath } from './workspaces.ipc';

/** Metadados (banco) e ciclo de vida (abrir/criar/fechar) das coleções. */
export class CollectionsIpcModule implements IIpcModule {
    constructor(
        private readonly collections: ICollectionMetadataRepository,
        private readonly service: CollectionService,
        private readonly workspaces: WorkspaceService,
        private readonly notifier: IRendererNotifier
    ) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('collections:list', () => this.collections.findAll());

        ipc.handle('collections:get', (_event, id) => this.collections.findById(parseEntityId(id)));

        ipc.handle('collections:create', (_event, input) => this.collections.create(parseNewCollection(input)));

        ipc.handle('collections:update', (_event, id, patch) => this.collections.update(parseEntityId(id), parseCollectionPatch(patch)));

        ipc.handle('collections:delete', async (_event, rawId) => {
            const id = parseEntityId(rawId);

            await this.workspaces.removeCollection(id);

            return this.collections.delete(id);
        });

        // Criar/importar inclui a coleção no workspace ativo (dentro da pasta dele); fechar tira (sem apagar a pasta).
        ipc.handle('collections:new', (_event, name) => this.workspaces.createCollection(parseEntryName(name)));

        ipc.handle('collections:import', (_event, source) => this.workspaces.importCollection(parseCollectionPath(source, 'source')));

        ipc.handle('collections:export', (_event, id, file) => this.workspaces.exportCollection(parseEntityId(id), parseArchivePath(file)));

        ipc.handle('collections:close', (_event, id) => this.workspaces.removeCollection(parseEntityId(id)));

        ipc.handle('collections:tree', (_event, id) => this.service.tree(parseEntityId(id)));

        ipc.handle('collections:manifest', (_event, id) => this.service.manifest(parseEntityId(id)));

        // Descrição e headers da coleção (gravados no otto.yaml).
        ipc.handle('collections:update-manifest', (_event, id, rawPatch) => {
            const patch = requireRecord(rawPatch, 'patch');
            const description = patch['description'] === undefined ? undefined : requireString(patch['description'], 'patch.description', { allowEmpty: true, maxLength: 100_000 });
            const headers = patch['headers'] === undefined ? undefined : parseKeyValues(patch['headers'], 'patch.headers');

            return this.service.updateManifest(parseEntityId(id), (manifest) => ({ ...manifest, ...(description !== undefined && { description }), ...(headers && { headers }) }));
        });

        this.service.onChanged((collectionId) => this.notifier.notify('collections:changed', { collectionId }));
    }
}
