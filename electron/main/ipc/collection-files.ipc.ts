import type { IIpcModule, IIpcRegistrar } from '../core/contracts';
import { parseEntityId, parseEntryName, parseRelativePath, parseRequestDefinition } from '../core/validation';
import type { CollectionService } from '../services/collections/collection.service';

/** Leitura e escrita de arquivos dentro das coleções (caminhos relativos à raiz). */
export class CollectionFilesIpcModule implements IIpcModule {
    constructor(private readonly service: CollectionService) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('collection-files:read-request', (_event, id, path) => this.service.readRequest(parseEntityId(id), parseRelativePath(path)));

        ipc.handle('collection-files:save-request', (_event, id, path, request) => this.service.saveRequest(parseEntityId(id), parseRelativePath(path), parseRequestDefinition(request)));

        ipc.handle('collection-files:create-request', (_event, id, folder, request) => this.service.createRequest(parseEntityId(id), parseRelativePath(folder, 'folder'), parseRequestDefinition(request)));

        ipc.handle('collection-files:create-folder', (_event, id, parent, name) => this.service.createFolder(parseEntityId(id), parseRelativePath(parent, 'parent'), parseEntryName(name)));

        ipc.handle('collection-files:move', (_event, id, from, to) => this.service.move(parseEntityId(id), parseRelativePath(from, 'from'), parseRelativePath(to, 'to')));

        ipc.handle('collection-files:remove', (_event, id, path) => this.service.remove(parseEntityId(id), parseRelativePath(path)));
    }
}
