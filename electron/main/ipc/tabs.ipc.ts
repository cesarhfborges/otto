import type { IIpcModule, IIpcRegistrar, ITabRepository } from '../core/contracts';
import { parseEntityId, parseTabs } from '../core/validation';

/** Abas por workspace (o renderer informa qual, evitando gravar no workspace errado durante a troca). */
export class TabsIpcModule implements IIpcModule {
    constructor(private readonly tabs: ITabRepository) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('tabs:list', (_event, workspaceId) => this.tabs.list(parseEntityId(workspaceId, 'workspaceId')));

        ipc.handle('tabs:save', (_event, workspaceId, tabs) => this.tabs.replaceAll(parseEntityId(workspaceId, 'workspaceId'), parseTabs(tabs)));
    }
}
