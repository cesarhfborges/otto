import * as path from 'node:path';
import { COLLECTION_EXPORT_FORMATS, type CollectionExportFormat, type CollectionImportRequest } from '../../shared/models';
import type { ICollectionMetadataRepository, IIpcModule, IIpcRegistrar, IRendererNotifier } from '../core/contracts';
import { parseCollectionPatch, parseCollectionPath, parseEntityId, parseEntryName, parseNewCollection, parseKeyValues, parseOpenApiConfig, requireBoolean, requireOneOf, requireRecord, requireString, ValidationError } from '../core/validation';
import type { CollectionService } from '../services/collections/collection.service';
import type { OpenApiService } from '../services/openapi/openapi.service';
import type { WorkspaceService } from '../services/workspaces/workspace.service';
import { parseArchivePath } from './workspaces.ipc';

function parseImportRequest(raw: unknown): CollectionImportRequest {
    const request = requireRecord(raw, 'request');

    if (requireOneOf(request['type'], ['backup', 'openapi'] as const, 'request.type') === 'backup') {
        return { type: 'backup', file: parseArchivePath(request['file']) };
    }

    const { source } = parseOpenApiConfig({ source: request['source'] }, 'request');

    return { type: 'openapi', source: source.type === 'file' ? { type: 'file', location: parseCollectionPath(source.location, 'request.source.location') } : source, autoSync: requireBoolean(request['autoSync'], 'request.autoSync') };
}

/** Destino da exportação: .zip para backup; .yaml/.yml/.json para OpenAPI. */
function parseExportTarget(rawFormat: unknown, rawFile: unknown): { format: CollectionExportFormat; file: string } {
    const format = requireOneOf(rawFormat, COLLECTION_EXPORT_FORMATS, 'format');

    if (format === 'backup') {
        return { format, file: parseArchivePath(rawFile) };
    }

    const file = parseCollectionPath(rawFile, 'file');

    if (!['.yaml', '.yml', '.json'].includes(path.extname(file).toLowerCase())) {
        throw new ValidationError('file', 'must be a .yaml, .yml or .json file');
    }

    return { format, file };
}

/** Metadados (banco) e ciclo de vida (abrir/criar/fechar) das coleções. */
export class CollectionsIpcModule implements IIpcModule {
    constructor(
        private readonly collections: ICollectionMetadataRepository,
        private readonly service: CollectionService,
        private readonly workspaces: WorkspaceService,
        private readonly openapi: OpenApiService,
        private readonly notifier: IRendererNotifier
    ) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('collections:list', () => this.collections.findAll());

        ipc.handle('collections:get', (_event, id) => this.collections.findById(parseEntityId(id)));

        ipc.handle('collections:create', (_event, input) => this.collections.create(parseNewCollection(input)));

        ipc.handle('collections:update', (_event, id, patch) => this.collections.update(parseEntityId(id), parseCollectionPatch(patch)));

        ipc.handle('collections:delete', async (_event, rawId) => {
            const id = parseEntityId(rawId);

            await this.workspaces.removeCollection(id);

            return this.collections.delete(id);
        });

        // Criar/importar inclui a coleção no workspace ativo (dentro da pasta dele); fechar tira (sem apagar a pasta).
        ipc.handle('collections:new', (_event, name) => this.workspaces.createCollection(parseEntryName(name)));

        ipc.handle('collections:import', (_event, raw) => {
            const request = parseImportRequest(raw);

            return request.type === 'backup' ? this.workspaces.importCollection(request.file) : this.openapi.importSpec(request.source, request.autoSync, (name) => this.workspaces.createCollection(name));
        });

        ipc.handle('collections:export', (_event, rawId, rawFormat, rawFile) => {
            const id = parseEntityId(rawId);
            const { format, file } = parseExportTarget(rawFormat, rawFile);

            return format === 'backup' ? this.workspaces.exportCollection(id, file) : this.openapi.exportSpec(id, file);
        });

        ipc.handle('collections:close', (_event, id) => this.workspaces.removeCollection(parseEntityId(id)));

        // Tira do workspace e envia a pasta da coleção para a lixeira do sistema.
        ipc.handle('collections:trash', (_event, id) => this.workspaces.trashCollection(parseEntityId(id)));

        ipc.handle('collections:tree', (_event, id) => this.service.tree(parseEntityId(id)));

        ipc.handle('collections:manifest', (_event, id) => this.service.manifest(parseEntityId(id)));

        // Descrição, headers e variáveis da coleção (gravados no otto.yaml).
        ipc.handle('collections:update-manifest', (_event, id, rawPatch) => {
            const patch = requireRecord(rawPatch, 'patch');
            const description = patch['description'] === undefined ? undefined : requireString(patch['description'], 'patch.description', { allowEmpty: true, maxLength: 100_000 });
            const headers = patch['headers'] === undefined ? undefined : parseKeyValues(patch['headers'], 'patch.headers');
            const variables = patch['variables'] === undefined ? undefined : parseKeyValues(patch['variables'], 'patch.variables');

            return this.service.updateManifest(parseEntityId(id), (manifest) => ({ ...manifest, ...(description !== undefined && { description }), ...(headers && { headers }), ...(variables && { variables }) }));
        });

        this.service.onChanged((collectionId) => this.notifier.notify('collections:changed', { collectionId }));
    }
}
