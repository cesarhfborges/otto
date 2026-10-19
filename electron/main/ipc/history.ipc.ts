import type { IHistoryRepository, IIpcModule, IIpcRegistrar } from '../core/contracts';
import { parseEntityId, parseHistoryQuery } from '../core/validation';

export class HistoryIpcModule implements IIpcModule {
    constructor(private readonly history: IHistoryRepository) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('history:list', (_event, query) => this.history.list(parseHistoryQuery(query)));

        ipc.handle('history:delete', (_event, id) => this.history.delete(parseEntityId(id)));

        ipc.handle('history:clear', () => this.history.clear());
    }
}
