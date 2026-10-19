import type { IIpcModule, IIpcRegistrar, ITabRepository } from '../core/contracts';
import { parseTabs } from '../core/validation';

export class TabsIpcModule implements IIpcModule {
    constructor(private readonly tabs: ITabRepository) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('tabs:list', () => this.tabs.list());

        ipc.handle('tabs:save', (_event, tabs) => this.tabs.replaceAll(parseTabs(tabs)));
    }
}
