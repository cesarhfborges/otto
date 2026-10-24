import type { IIpcModule, IIpcRegistrar } from '../core/contracts';
import { parseEntityId, requireInteger } from '../core/validation';
import type { MockServerService } from '../services/mock/mock-server.service';

/** Mock servers locais das coleções. */
export class MockIpcModule implements IIpcModule {
    constructor(private readonly mocks: MockServerService) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('mock:list', () => this.mocks.list());

        ipc.handle('mock:start', (_event, id, port) => this.mocks.start(parseEntityId(id), requireInteger(port, 'port', 1024, 65_535)));

        ipc.handle('mock:stop', (_event, id) => this.mocks.stop(parseEntityId(id)));
    }
}
