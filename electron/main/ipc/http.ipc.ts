import type { IHttpExecutor, IIpcModule, IIpcRegistrar } from '../core/contracts';
import { parseHttpRequest, parseRequestId } from '../core/validation';

/**
 * As requisições são executadas no processo main e não no renderer:
 * assim não há CORS e temos controle total sobre headers e tempos.
 */
export class HttpIpcModule implements IIpcModule {
    constructor(private readonly executor: IHttpExecutor) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('http:send', (_event, raw) => this.executor.execute(parseHttpRequest(raw)));

        ipc.handle('http:cancel', (_event, id) => this.executor.cancel(parseRequestId(id)));
    }
}
