import * as path from 'node:path';
import type { IIpcModule, IIpcRegistrar, IRendererNotifier } from '../core/contracts';
import { parseCollectionPath, parseEntityId, parseEntryName, ValidationError } from '../core/validation';
import type { WorkspaceService } from '../services/workspaces/workspace.service';

/** Caminho absoluto de um arquivo `.zip`. */
export function parseArchivePath(raw: unknown): string {
    const file = parseCollectionPath(raw, 'file');

    if (path.extname(file).toLowerCase() !== '.zip') {
        throw new ValidationError('file', 'must be a .zip file');
    }

    return file;
}

export class WorkspacesIpcModule implements IIpcModule {
    constructor(
        private readonly workspaces: WorkspaceService,
        private readonly notifier: IRendererNotifier,
        /** Mostra a pasta no gerenciador de arquivos (`shell.showItemInFolder`). */
        private readonly reveal: (absolutePath: string) => void
    ) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('workspaces:list', () => this.workspaces.list());

        ipc.handle('workspaces:load', () => this.workspaces.load());

        ipc.handle('workspaces:switch', (_event, id) => this.workspaces.switch(parseEntityId(id)));

        ipc.handle('workspaces:create', (_event, name) => this.workspaces.create(parseEntryName(name)));

        ipc.handle('workspaces:rename', (_event, id, name) => this.workspaces.rename(parseEntityId(id), parseEntryName(name)));

        ipc.handle('workspaces:remove', (_event, id) => this.workspaces.remove(parseEntityId(id)));

        ipc.handle('workspaces:recreate', (_event, id) => this.workspaces.recreate(parseEntityId(id)));

        ipc.handle('workspaces:export', (_event, id, file) => this.workspaces.export(parseEntityId(id), parseArchivePath(file)));

        ipc.handle('workspaces:move-all', (_event, from, to) => this.workspaces.moveAll(parseCollectionPath(from, 'from'), parseCollectionPath(to, 'to')));

        ipc.handle('workspaces:import', (_event, file) => this.workspaces.import(parseArchivePath(file)));

        ipc.handle('workspaces:reveal', (_event, id) => {
            const folder = this.workspaces.get(parseEntityId(id)).path;

            if (folder) {
                this.reveal(folder);
            }
        });

        this.workspaces.onChanged(() => this.notifier.notify('workspaces:changed', null));
    }
}
