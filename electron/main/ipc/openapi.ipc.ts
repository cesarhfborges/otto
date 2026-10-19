import type { IIpcModule, IIpcRegistrar } from '../core/contracts';
import { parseEntityId, parseOpenApiConfig, requireArray, requireString } from '../core/validation';
import type { OpenApiService } from '../services/openapi/openapi.service';

const parseKeys = (raw: unknown): string[] => requireArray(raw, 'keys', 5_000).map((key, i) => requireString(key, `keys[${i}]`, { maxLength: 2_000 }));

/** Ligação de coleções com specs OpenAPI: verificar, sincronizar e reverter. */
export class OpenApiIpcModule implements IIpcModule {
    constructor(private readonly openapi: OpenApiService) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('openapi:status', (_event, id, refresh) => this.openapi.status(parseEntityId(id), refresh === true));

        ipc.handle('openapi:connect', (_event, id, config) => this.openapi.connect(parseEntityId(id), parseOpenApiConfig(config, 'config')));

        ipc.handle('openapi:disconnect', (_event, id) => this.openapi.disconnect(parseEntityId(id)));

        ipc.handle('openapi:spec', (_event, id) => this.openapi.specText(parseEntityId(id)));

        ipc.handle('openapi:sync', (_event, id, keys) => this.openapi.sync(parseEntityId(id), parseKeys(keys)));

        ipc.handle('openapi:revert', (_event, id, keys) => this.openapi.revert(parseEntityId(id), parseKeys(keys)));
    }
}
