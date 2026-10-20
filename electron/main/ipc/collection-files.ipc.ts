import type { IIpcModule, IIpcRegistrar } from '../core/contracts';
import { parseEntityId, parseEntryName, parseRelativePath, parseRequestDefinition, requireArray, requireString } from '../core/validation';
import type { CollectionService } from '../services/collections/collection.service';

const MAX_REORDER_ENTRIES = 1_000;

/** Leitura e escrita de arquivos dentro das coleções (caminhos relativos à raiz). */
export class CollectionFilesIpcModule implements IIpcModule {
    constructor(
        private readonly service: CollectionService,
        /** Mostra o item no gerenciador de arquivos (`shell.showItemInFolder`). */
        private readonly reveal: (absolutePath: string) => void
    ) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('collection-files:read-request', (_event, id, path) => this.service.readRequest(parseEntityId(id), parseRelativePath(path)));

        ipc.handle('collection-files:save-request', (_event, id, path, request) => this.service.saveRequest(parseEntityId(id), parseRelativePath(path), parseRequestDefinition(request)));

        ipc.handle('collection-files:create-request', (_event, id, folder, request) => this.service.createRequest(parseEntityId(id), parseRelativePath(folder, 'folder'), parseRequestDefinition(request)));

        ipc.handle('collection-files:create-folder', (_event, id, parent, name) => this.service.createFolder(parseEntityId(id), parseRelativePath(parent, 'parent'), parseEntryName(name)));

        ipc.handle('collection-files:move', (_event, id, from, to) => this.service.move(parseEntityId(id), parseRelativePath(from, 'from'), parseRelativePath(to, 'to')));

        // Requisições aceitam qualquer nome (o arquivo usa o slug); pastas são validadas no serviço.
        ipc.handle('collection-files:duplicate', (_event, id, path, name) => this.service.duplicate(parseEntityId(id), parseRelativePath(path), requireString(name, 'name', { maxLength: 200 }).trim()));

        ipc.handle('collection-files:rename', (_event, id, path, name) => this.service.rename(parseEntityId(id), parseRelativePath(path), requireString(name, 'name', { maxLength: 200 }).trim()));

        ipc.handle('collection-files:reorder', (_event, id, entries) =>
            this.service.reorder(
                parseEntityId(id),
                requireArray(entries, 'entries', MAX_REORDER_ENTRIES).map((entry, i) => parseRelativePath(entry, `entries[${i}]`))
            )
        );

        ipc.handle('collection-files:remove', (_event, id, path) => this.service.remove(parseEntityId(id), parseRelativePath(path)));

        ipc.handle('collection-files:reveal', async (_event, id, path) => this.reveal(await this.service.revealPath(parseEntityId(id), parseRelativePath(path))));
    }
}
