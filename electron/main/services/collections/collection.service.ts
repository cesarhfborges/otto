import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { COLLECTION_FORMAT_VERSION, type CollectionManifest, type CollectionMetadata, type CollectionNode, type CollectionTree, type EntityId, type OpenedCollection, type RequestDefinition } from '../../../shared/models';
import type { CollectionEntry, IClock, ICollectionFormat, ICollectionMetadataRepository, ICollectionStore, ICollectionWatcher } from '../../core/contracts';
import { slugify } from './slug';

const MAX_NAME_ATTEMPTS = 1_000;

const joinRelative = (folder: string, name: string): string => (folder ? `${folder.replace(/\/+$/, '')}/${name}` : name);

const byFolderThenOrder = (a: CollectionNode, b: CollectionNode): number => {
    if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
    }

    if (a.type === 'request' && b.type === 'request' && a.seq !== b.seq) {
        // Numeradas primeiro, em ordem; sem `seq` depois, por nome.
        return a.seq === null ? 1 : b.seq === null ? -1 : a.seq - b.seq;
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
};

/**
 * Coleções no disco (fonte da verdade do conteúdo) mapeadas para os metadados no
 * SQLite (id, caminho, última abertura). Toda E/S passa pelo `ICollectionStore`,
 * que confina os caminhos à pasta da coleção.
 */
export class CollectionService {
    private readonly events = new EventEmitter<{ changed: [EntityId] }>();
    private readonly watchers = new Map<EntityId, () => void>();

    constructor(
        private readonly store: ICollectionStore,
        private readonly format: ICollectionFormat,
        private readonly metadata: ICollectionMetadataRepository,
        private readonly watcher: ICollectionWatcher,
        private readonly clock: IClock
    ) {}

    /** Abre uma pasta existente que contenha o manifesto e a registra/atualiza no banco. */
    async open(directory: string): Promise<OpenedCollection> {
        const root = path.resolve(directory);

        if (!(await this.store.isDirectory(root))) {
            throw new Error(`Folder "${root}" does not exist`);
        }

        const manifest = await this.readManifest(root);
        const now = this.clock.now();
        const existing = this.metadata.findByPath(root);
        const metadata = existing ? this.metadata.update(existing.id, { name: manifest.name, lastOpenedAt: now, open: true })! : this.metadata.create({ name: manifest.name, path: root, source: null, lastOpenedAt: now, open: true });

        this.startWatching(metadata);

        return { metadata, manifest, tree: await this.buildTree(root, manifest.name) };
    }

    /** Cria `parentDirectory/<slug do nome>` com o manifesto e abre a coleção. */
    async create(parentDirectory: string, name: string): Promise<OpenedCollection> {
        const root = path.join(path.resolve(parentDirectory), slugify(name, 'collection'));

        if (await this.store.exists(root, this.format.manifestFile).catch(() => false)) {
            throw new Error(`"${root}" is already an Otto collection. Use Open Collection instead.`);
        }

        await this.store.createRoot(root);

        const manifest: CollectionManifest = { version: COLLECTION_FORMAT_VERSION, name, description: '' };

        await this.store.writeFile(root, this.format.manifestFile, this.format.serializeManifest(manifest), { createOnly: true });

        return this.open(root);
    }

    async tree(id: EntityId): Promise<CollectionTree> {
        const collection = this.resolve(id);

        return this.buildTree(collection.path, collection.name);
    }

    async readRequest(id: EntityId, requestPath: string): Promise<RequestDefinition> {
        this.assertRequestPath(requestPath);

        return this.format.parseRequest(await this.store.readFile(this.resolve(id).path, requestPath));
    }

    /** Sobrescreve uma requisição existente (ou cria no caminho indicado). */
    async saveRequest(id: EntityId, requestPath: string, request: RequestDefinition): Promise<void> {
        this.assertRequestPath(requestPath);
        await this.store.writeFile(this.resolve(id).path, requestPath, this.format.serializeRequest(request));
        this.emitChanged(id);
    }

    /** Cria um arquivo novo na pasta, com nome derivado do nome da requisição. Retorna o caminho. */
    async createRequest(id: EntityId, folder: string, request: RequestDefinition): Promise<string> {
        const root = this.resolve(id).path;
        const requestPath = await this.availablePath(root, folder, (suffix) => this.format.requestFileName(slugify(request.name, 'request') + suffix));

        await this.store.writeFile(root, requestPath, this.format.serializeRequest(request), { createOnly: true });
        this.emitChanged(id);

        return requestPath;
    }

    async createFolder(id: EntityId, parent: string, name: string): Promise<string> {
        const folderPath = joinRelative(parent, name);

        await this.store.createDirectory(this.resolve(id).path, folderPath);
        this.emitChanged(id);

        return folderPath;
    }

    /** Move/renomeia um arquivo ou pasta. Requisições precisam manter a extensão do formato. */
    async move(id: EntityId, from: string, to: string): Promise<void> {
        this.assertNotManifest(from);
        this.assertNotManifest(to);

        if (this.format.isRequestFile(path.posix.basename(from)) && !this.format.isRequestFile(path.posix.basename(to))) {
            throw new Error(`"${to}" is not a valid request file name`);
        }

        await this.store.move(this.resolve(id).path, from, to);
        this.emitChanged(id);
    }

    /** Envia o arquivo ou a pasta para a lixeira do sistema. */
    async remove(id: EntityId, entryPath: string): Promise<void> {
        this.assertNotManifest(entryPath);
        await this.store.remove(this.resolve(id).path, entryPath);
        this.emitChanged(id);
    }

    /** Fecha na barra lateral e para de observar a pasta (a coleção continua registrada no banco). */
    close(id: EntityId): void {
        this.stopWatching(id);

        if (this.metadata.findById(id)?.open) {
            this.metadata.update(id, { open: false });
        }
    }

    /** Ao encerrar o app: só libera os watchers, mantendo `open` para reabrir na próxima vez. */
    closeAll(): void {
        for (const id of [...this.watchers.keys()]) {
            this.stopWatching(id);
        }
    }

    private stopWatching(id: EntityId): void {
        this.watchers.get(id)?.();
        this.watchers.delete(id);
    }

    onChanged(listener: (collectionId: EntityId) => void): () => void {
        this.events.on('changed', listener);

        return () => this.events.off('changed', listener);
    }

    private resolve(id: EntityId): CollectionMetadata {
        const collection = this.metadata.findById(id);

        if (!collection) {
            throw new Error(`Collection "${id}" not found`);
        }

        return collection;
    }

    private async readManifest(root: string): Promise<CollectionManifest> {
        let content: string;

        try {
            content = await this.store.readFile(root, this.format.manifestFile);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw new Error(`"${root}" is not an Otto collection: ${this.format.manifestFile} not found. Use New Collection to create one.`);
            }

            throw error;
        }

        return this.format.parseManifest(content);
    }

    private async buildTree(root: string, name: string): Promise<CollectionTree> {
        const toNodes = async (entries: CollectionEntry[]): Promise<CollectionNode[]> => {
            const nodes = await Promise.all(
                entries.map(async (entry): Promise<CollectionNode | null> => {
                    if (entry.kind === 'directory') {
                        return { type: 'folder', name: entry.name, path: entry.path, children: await toNodes(entry.children) };
                    }

                    if (!this.format.isRequestFile(entry.name)) {
                        return null;
                    }

                    try {
                        const request = this.format.parseRequest(await this.store.readFile(root, entry.path));

                        return { type: 'request', name: request.name, path: entry.path, method: request.method, seq: request.seq, error: null };
                    } catch (error) {
                        // Arquivo inválido continua visível na árvore para o usuário corrigir.
                        return { type: 'request', name: entry.name, path: entry.path, method: null, seq: null, error: error instanceof Error ? error.message : String(error) };
                    }
                })
            );

            return nodes.filter((node): node is CollectionNode => node !== null).sort(byFolderThenOrder);
        };

        return { root, name, children: await toNodes(await this.store.list(root)) };
    }

    private async availablePath(root: string, folder: string, fileName: (suffix: string) => string): Promise<string> {
        for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
            const candidate = joinRelative(folder, fileName(attempt === 1 ? '' : `-${attempt}`));

            if (!(await this.store.exists(root, candidate))) {
                return candidate;
            }
        }

        throw new Error('Could not find an available file name');
    }

    private assertRequestPath(requestPath: string): void {
        if (!this.format.isRequestFile(path.posix.basename(requestPath))) {
            throw new Error(`"${requestPath}" is not a request file`);
        }
    }

    private assertNotManifest(entryPath: string): void {
        if (entryPath.replace(/^\/+|\/+$/g, '') === this.format.manifestFile || !entryPath.replace(/[/.]/g, '')) {
            throw new Error(`"${entryPath}" cannot be changed`);
        }
    }

    private startWatching(collection: CollectionMetadata): void {
        if (!this.watchers.has(collection.id)) {
            this.watchers.set(
                collection.id,
                this.watcher.watch(collection.path, () => this.emitChanged(collection.id))
            );
        }
    }

    private emitChanged(id: EntityId): void {
        this.events.emit('changed', id);
    }
}
