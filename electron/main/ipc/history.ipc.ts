import type { IHistoryRepository, IIpcModule, IIpcRegistrar } from '../core/contracts';
import { parseEntityId, parseHistoryQuery, parseHistoryScope } from '../core/validation';

export class HistoryIpcModule implements IIpcModule {
    constructor(private readonly history: IHistoryRepository) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('history:list', (_event, query) => this.history.list(parseHistoryQuery(query)));

        ipc.handle('history:get', (_event, id) => this.history.get(parseEntityId(id)));

        ipc.handle('history:delete', (_event, id) => this.history.delete(parseEntityId(id)));

        ipc.handle('history:clear', (_event, scope) => this.history.clear(parseHistoryScope(scope)));
    }
}
