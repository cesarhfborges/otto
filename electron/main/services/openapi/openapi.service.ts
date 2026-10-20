import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { EndpointChange, EntityId, IsoDateTime, OpenApiConfig, OpenApiStatus, RequestDefinition } from '../../../shared/models';
import type { IClock, IEnvironmentRepository, IHttpExecutor } from '../../core/contracts';
import { convertSpec, parseSpec, type ConvertedSpec } from '../../infra/openapi/openapi-converter';
import type { CollectionService } from '../collections/collection.service';

/** Último spec sincronizado, na raiz da coleção (vai junto no Git e na exportação). */
export const OPENAPI_SNAPSHOT_FILE = 'openapi-snapshot.json';

interface Snapshot {
    version: 1;
    syncedAt: IsoDateTime;
    specVersion: string;
    operations: Record<string, { folder: string; request: RequestDefinition }>;
}

interface CachedSpec {
    text: string;
    converted: ConvertedSpec | null;
    error: string | null;
    checkedAt: IsoDateTime;
}

/** Leitura de arquivos fora da coleção (spec local escolhido pelo usuário). */
export interface SpecFileReader {
    read(file: string): Promise<string>;
}

const EMPTY_SNAPSHOT = (): Snapshot => ({ version: 1, syncedAt: '', specVersion: '', operations: {} });

/** Compara só o que a sincronização controla: método, URL, params, headers, body e auth. */
const comparable = (request: RequestDefinition): string => JSON.stringify({ method: request.method, url: request.url, params: request.params, headers: request.headers, auth: request.auth, body: request.body });

const same = (a: RequestDefinition, b: RequestDefinition): boolean => comparable(a) === comparable(b);

const splitKey = (key: string): { method: EndpointChange['method']; path: string } => {
    const [method, ...rest] = key.split(' ');

    return { method: method as EndpointChange['method'], path: rest.join(' ') };
};

/**
 * Sincronização de uma coleção com um spec OpenAPI/Swagger. Três versões são comparadas:
 * o spec atual, o snapshot do último sincronizado e as requisições da coleção
 * (ligadas por `operation`). Atualizações do spec só são aplicadas após confirmação.
 */
export class OpenApiService {
    private readonly cache = new Map<EntityId, CachedSpec>();

    constructor(
        private readonly collections: CollectionService,
        private readonly http: IHttpExecutor,
        private readonly files: SpecFileReader,
        private readonly environments: IEnvironmentRepository,
        private readonly clock: IClock
    ) {}

    /** Situação atual; `refresh` busca o spec de novo (botão "Check for updates" e verificação automática). */
    async status(collectionId: EntityId, refresh = false): Promise<OpenApiStatus> {
        const manifest = await this.collections.manifest(collectionId);
        const config = manifest.openapi;
        const snapshot = await this.readSnapshot(collectionId);
        const base: OpenApiStatus = {
            config,
            spec: null,
            error: null,
            lastCheckedAt: null,
            lastSyncedAt: snapshot.syncedAt || null,
            syncedSpecVersion: snapshot.specVersion || null,
            linkedRequests: 0,
            inSync: 0,
            specUpdates: [],
            collectionChanges: []
        };

        if (!config) {
            return base;
        }

        const cached = refresh || !this.cache.has(collectionId) ? await this.fetch(collectionId, config) : this.cache.get(collectionId)!;
        const local = await this.localRequests(collectionId);
        const collectionChanges = this.collectionChanges(snapshot, local);

        if (!cached.converted) {
            return { ...base, error: cached.error, lastCheckedAt: cached.checkedAt, linkedRequests: local.size, collectionChanges };
        }

        const spec = cached.converted;
        const specUpdates = this.specUpdates(spec, snapshot, local);
        const changedKeys = new Set([...specUpdates, ...collectionChanges].map((change) => change.key));

        return {
            ...base,
            spec: spec.info,
            lastCheckedAt: cached.checkedAt,
            linkedRequests: local.size,
            inSync: Object.keys(snapshot.operations).filter((key) => local.has(key) && !changedKeys.has(key)).length,
            specUpdates,
            collectionChanges
        };
    }

    /** Liga (ou reconfigura) a coleção a um spec e verifica na hora. */
    async connect(collectionId: EntityId, config: OpenApiConfig): Promise<OpenApiStatus> {
        await this.collections.updateManifest(collectionId, (manifest) => ({ ...manifest, openapi: config }));
        this.cache.delete(collectionId);

        return this.status(collectionId, true);
    }

    /** Desliga a sincronização (as requisições continuam na coleção). */
    async disconnect(collectionId: EntityId): Promise<void> {
        await this.collections.updateManifest(collectionId, (manifest) => ({ ...manifest, openapi: null }));
        this.cache.delete(collectionId);
    }

    /** Texto do spec da última verificação ("View spec"). */
    async specText(collectionId: EntityId): Promise<string> {
        const config = (await this.collections.manifest(collectionId)).openapi;

        if (!config) {
            throw new Error('This collection is not linked to an OpenAPI spec');
        }

        return (this.cache.get(collectionId) ?? (await this.fetch(collectionId, config))).text;
    }

    /**
     * Aplica as atualizações do spec escolhidas (substituição completa da requisição):
     * novas viram arquivos, alteradas são sobrescritas e removidas vão para a lixeira.
     * Itens não escolhidos continuam pendentes.
     */
    async sync(collectionId: EntityId, keys: string[]): Promise<OpenApiStatus> {
        const config = (await this.collections.manifest(collectionId)).openapi;
        const spec = config ? this.cache.get(collectionId)?.converted : null;

        if (!config || !spec) {
            throw new Error('Check for updates before syncing');
        }

        const snapshot = await this.readSnapshot(collectionId);
        const local = await this.localRequests(collectionId);
        const byKey = new Map(spec.operations.map((operation) => [operation.key, operation]));

        for (const key of new Set(keys)) {
            const operation = byKey.get(key);
            const existing = local.get(key);

            if (operation) {
                await this.writeRequest(collectionId, operation.folder, operation.request, existing?.path);
                snapshot.operations[key] = { folder: operation.folder, request: operation.request };
            } else if (snapshot.operations[key]) {
                // Endpoint removido do spec.
                if (existing) {
                    await this.collections.remove(collectionId, existing.path);
                }

                delete snapshot.operations[key];
            }
        }

        snapshot.syncedAt = this.clock.now();
        snapshot.specVersion = spec.info.version;
        await this.writeSnapshot(collectionId, snapshot);
        this.ensureEnvironment(collectionId, spec);

        return this.status(collectionId);
    }

    /** Desfaz edições locais: a requisição volta a ser a do último spec sincronizado. */
    async revert(collectionId: EntityId, keys: string[]): Promise<OpenApiStatus> {
        const snapshot = await this.readSnapshot(collectionId);
        const local = await this.localRequests(collectionId);

        for (const key of new Set(keys)) {
            const synced = snapshot.operations[key];

            if (synced) {
                await this.writeRequest(collectionId, synced.folder, synced.request, local.get(key)?.path);
            }
        }

        return this.status(collectionId);
    }

    private specUpdates(spec: ConvertedSpec, snapshot: Snapshot, local: Map<string, { path: string; request: RequestDefinition }>): EndpointChange[] {
        const changes: EndpointChange[] = [];
        const specKeys = new Set<string>();

        for (const operation of spec.operations) {
            const synced = snapshot.operations[operation.key]?.request;
            const current = local.get(operation.key);

            specKeys.add(operation.key);

            if (!synced) {
                // Nunca sincronizado: só é novidade se a coleção ainda não tiver igual.
                if (!current || !same(current.request, operation.request)) {
                    changes.push(this.change(operation.key, operation.operationId, 'added', current?.request ?? null, operation.request, current?.path ?? null));
                }
            } else if (!same(synced, operation.request)) {
                changes.push(this.change(operation.key, operation.operationId, 'modified', current?.request ?? synced, operation.request, current?.path ?? null));
            }
        }

        for (const [key, synced] of Object.entries(snapshot.operations)) {
            if (!specKeys.has(key)) {
                const current = local.get(key);

                changes.push(this.change(key, null, 'removed', current?.request ?? synced.request, null, current?.path ?? null));
            }
        }

        return changes;
    }

    private collectionChanges(snapshot: Snapshot, local: Map<string, { path: string; request: RequestDefinition }>): EndpointChange[] {
        return Object.entries(snapshot.operations).flatMap(([key, synced]): EndpointChange[] => {
            const current = local.get(key);

            if (!current) {
                return [this.change(key, null, 'removed', synced.request, null, null)];
            }

            return same(synced.request, current.request) ? [] : [this.change(key, null, 'modified', synced.request, current.request, current.path)];
        });
    }

    private change(key: string, operationId: string | null, kind: EndpointChange['kind'], before: RequestDefinition | null, after: RequestDefinition | null, requestPath: string | null): EndpointChange {
        return { key, ...splitKey(key), operationId, kind, before, after, requestPath };
    }

    private async fetch(collectionId: EntityId, config: OpenApiConfig): Promise<CachedSpec> {
        const checkedAt = this.clock.now();
        let text = '';
        let entry: CachedSpec;

        try {
            text = await this.load(collectionId, config);
            entry = { text, converted: convertSpec(parseSpec(text), config.groupBy), error: null, checkedAt };
        } catch (error) {
            entry = { text, converted: null, error: error instanceof Error ? error.message : String(error), checkedAt };
        }

        this.cache.set(collectionId, entry);

        return entry;
    }

    private async load(collectionId: EntityId, config: OpenApiConfig): Promise<string> {
        if (config.source.type === 'file') {
            // Caminho relativo = relativo à pasta da coleção (portável no Git).
            const root = (await this.collections.manifestRoot(collectionId)) ?? '';
            const file = path.isAbsolute(config.source.location) ? config.source.location : path.resolve(root, config.source.location);

            return this.files.read(file);
        }

        const result = await this.http.execute({ id: randomUUID(), method: 'GET', url: config.source.location, headers: { accept: 'application/json, application/yaml;q=0.9, */*;q=0.8' } });

        if (!result.ok) {
            throw new Error(`Could not download the spec: ${result.error}`);
        }

        if (result.response.status >= 400) {
            throw new Error(`Could not download the spec: HTTP ${result.response.status} ${result.response.statusText}`);
        }

        return result.response.body;
    }

    private async localRequests(collectionId: EntityId): Promise<Map<string, { path: string; request: RequestDefinition }>> {
        const map = new Map<string, { path: string; request: RequestDefinition }>();

        for (const entry of await this.collections.requests(collectionId)) {
            if (entry.request.operation && !map.has(entry.request.operation)) {
                map.set(entry.request.operation, entry);
            }
        }

        return map;
    }

    private async writeRequest(collectionId: EntityId, folder: string, request: RequestDefinition, existingPath: string | undefined): Promise<void> {
        if (existingPath) {
            await this.collections.saveRequest(collectionId, existingPath, request);
        } else {
            await this.collections.createRequest(collectionId, folder, request);
        }
    }

    /** Coleção sem ambientes ganha um "Default" com `baseUrl` = primeiro servidor do spec. */
    private ensureEnvironment(collectionId: EntityId, spec: ConvertedSpec): void {
        const server = spec.info.servers[0];

        if (server && !this.environments.findByCollection(collectionId).length) {
            this.environments.create({ collectionId, name: 'Default', variables: [{ key: 'baseUrl', value: server, enabled: true, secret: false }] });
        }
    }

    private async readSnapshot(collectionId: EntityId): Promise<Snapshot> {
        try {
            const raw = await this.collections.readAuxFile(collectionId, OPENAPI_SNAPSHOT_FILE);
            const parsed = raw ? (JSON.parse(raw) as Partial<Snapshot>) : null;

            return parsed && typeof parsed.operations === 'object' && parsed.operations ? { ...EMPTY_SNAPSHOT(), ...parsed, operations: parsed.operations } : EMPTY_SNAPSHOT();
        } catch {
            // Snapshot corrompido: tudo volta a aparecer como novidade do spec.
            return EMPTY_SNAPSHOT();
        }
    }

    private async writeSnapshot(collectionId: EntityId, snapshot: Snapshot): Promise<void> {
        await this.collections.writeAuxFile(collectionId, OPENAPI_SNAPSHOT_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);
    }
}
