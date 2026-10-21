import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { COLLECTION_FORMAT_VERSION, type CollectionManifest, type CollectionMetadata, type CollectionNode, type CollectionTree, type EntityId, type OpenedCollection, type RequestDefinition } from '../../../shared/models';
import type { CollectionEntry, FolderMetadata, IClock, ICollectionFormat, ICollectionMetadataRepository, ICollectionStore, ICollectionWatcher } from '../../core/contracts';
import { slugify } from './slug';

const MAX_NAME_ATTEMPTS = 1_000;

const joinRelative = (folder: string, name: string): string => (folder ? `${folder.replace(/\/+$/, '')}/${name}` : name);

/** Pasta que contém o item ('' = raiz da coleção). */
const parentOf = (entryPath: string): string => {
    const parent = path.posix.dirname(entryPath);

    return parent === '.' ? '' : parent;
};

/** Mesma regra do `parseEntryName`: um único segmento, sem separadores e sem começar com ponto. */
const folderName = (name: string): string => {
    const value = name.trim();

    if (!value || /[/\\\0]/.test(value) || value.startsWith('.')) {
        throw new Error('Folder names cannot be empty, contain "/" or "\\" or start with "."');
    }

    return value;
};

const requestName = (name: string): string => {
    const value = name.trim();

    if (!value) {
        throw new Error('The request name cannot be empty');
    }

    return value;
};

function findEntry(entries: CollectionEntry[], entryPath: string): CollectionEntry | null {
    for (const entry of entries) {
        if (entry.path === entryPath) {
            return entry;
        }

        const found = entryPath.startsWith(`${entry.path}/`) ? findEntry(entry.children, entryPath) : null;

        if (found) {
            return found;
        }
    }

    return null;
}

/** Pastas sem `seq` primeiro, depois os itens numerados (pastas e requisições juntos) e por fim requisições sem `seq`. */
const orderRank = (node: CollectionNode): number => (node.seq !== null ? 1 : node.type === 'folder' ? 0 : 2);

const byOrder = (a: CollectionNode, b: CollectionNode): number => {
    const rank = orderRank(a) - orderRank(b);

    if (rank) {
        return rank;
    }

    if (a.seq !== null && b.seq !== null && a.seq !== b.seq) {
        return a.seq - b.seq;
    }

    if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
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

    /** Abre uma pasta existente que contenha o manifesto: registra/atualiza no banco, observa e lê a árvore. */
    async open(directory: string): Promise<OpenedCollection> {
        const { metadata, manifest } = await this.register(directory, this.clock.now());

        this.startWatching(metadata);

        return { metadata, manifest, tree: await this.buildTree(metadata.path, manifest.name) };
    }

    /** Valida a pasta e registra/atualiza a coleção no banco, sem observar nem ler a árvore. */
    async register(directory: string, lastOpenedAt?: string): Promise<{ metadata: CollectionMetadata; manifest: CollectionManifest }> {
        const root = path.resolve(directory);

        if (!(await this.store.isDirectory(root))) {
            throw new Error(`Folder "${root}" does not exist`);
        }

        const manifest = await this.readManifest(root);
        const existing = this.metadata.findByPath(root);
        const patch = { name: manifest.name, ...(lastOpenedAt && { lastOpenedAt }) };
        const metadata = existing ? this.metadata.update(existing.id, patch)! : this.metadata.create({ name: manifest.name, path: root, source: null, lastOpenedAt: lastOpenedAt ?? null });

        return { metadata, manifest };
    }

    /** Pasta raiz da coleção (para resolver caminhos relativos, ex.: spec OpenAPI local). */
    async manifestRoot(id: EntityId): Promise<string | null> {
        return this.metadata.findById(id)?.path ?? null;
    }

    async manifest(id: EntityId): Promise<CollectionManifest> {
        return this.readManifest(this.resolve(id).path);
    }

    /** Lê, altera e grava o `otto.yaml` (headers da coleção, ligação OpenAPI...). */
    async updateManifest(id: EntityId, change: (manifest: CollectionManifest) => CollectionManifest): Promise<CollectionManifest> {
        const root = this.resolve(id).path;
        const updated = change(await this.readManifest(root));

        await this.store.writeFile(root, this.format.manifestFile, this.format.serializeManifest(updated));
        this.emitChanged(id);

        return updated;
    }

    /** Todas as requisições válidas da coleção, com o caminho do arquivo. */
    async requests(id: EntityId): Promise<Array<{ path: string; request: RequestDefinition }>> {
        const root = this.resolve(id).path;
        const result: Array<{ path: string; request: RequestDefinition }> = [];
        const walk = async (entries: CollectionEntry[]): Promise<void> => {
            for (const entry of entries) {
                if (entry.kind === 'directory') {
                    await walk(entry.children);
                } else if (this.format.isRequestFile(entry.name)) {
                    try {
                        result.push({ path: entry.path, request: this.format.parseRequest(await this.store.readFile(root, entry.path)) });
                    } catch {
                        // Arquivo inválido: aparece na árvore com erro, mas não participa da sincronização.
                    }
                }
            }
        };

        await walk(await this.store.list(root));

        return result;
    }

    /** Arquivo auxiliar (não-requisição) na raiz da coleção; `null` se não existir. */
    async readAuxFile(id: EntityId, name: string): Promise<string | null> {
        const root = this.resolve(id).path;

        return (await this.store.exists(root, name)) ? this.store.readFile(root, name) : null;
    }

    async writeAuxFile(id: EntityId, name: string, content: string): Promise<void> {
        await this.store.writeFile(this.resolve(id).path, name, content);
    }

    /** Arquivos da coleção (exceto ocultos e symlinks), para exportação. Caminhos relativos com `/`. */
    async files(id: EntityId): Promise<Map<string, Uint8Array>> {
        const root = this.resolve(id).path;
        const files = new Map<string, Uint8Array>();
        const collect = async (entries: CollectionEntry[]): Promise<void> => {
            for (const entry of entries) {
                if (entry.kind === 'directory') {
                    await collect(entry.children);
                } else {
                    files.set(entry.path, await this.store.readBytes(root, entry.path));
                }
            }
        };

        await collect(await this.store.list(root));

        return files;
    }

    /** Cria `parentDirectory/<slug do nome>` com o manifesto e abre a coleção. */
    async create(parentDirectory: string, name: string): Promise<OpenedCollection> {
        const root = path.join(path.resolve(parentDirectory), slugify(name, 'collection'));

        if (await this.store.exists(root, this.format.manifestFile).catch(() => false)) {
            throw new Error(`A collection folder named "${path.basename(root)}" already exists. Choose another name.`);
        }

        await this.store.createRoot(root);

        const manifest: CollectionManifest = { version: COLLECTION_FORMAT_VERSION, name, description: '', headers: [], variables: [], openapi: null };

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

    /**
     * Copia a requisição (novo arquivo derivado do nome) ou a pasta com todo o conteúdo
     * para a mesma pasta do original, com o novo nome. Retorna o caminho criado.
     */
    async duplicate(id: EntityId, entryPath: string, name: string): Promise<string> {
        this.assertNotManifest(entryPath);

        const root = this.resolve(id).path;
        const parent = parentOf(entryPath);

        if (this.format.isRequestFile(path.posix.basename(entryPath))) {
            const request = this.format.parseRequest(await this.store.readFile(root, entryPath));

            // A cópia ganha um `id` novo (o do original continua apontando para ele).
            return this.createRequest(id, parent, { ...request, id: undefined, name: requestName(name) });
        }

        const source = findEntry(await this.store.list(root), entryPath);
        const target = joinRelative(parent, folderName(name));

        if (source?.kind !== 'directory') {
            throw new Error(`Folder "${entryPath}" not found`);
        }

        if (await this.store.exists(root, target)) {
            throw new Error(`An item named "${path.posix.basename(target)}" already exists in this folder`);
        }

        const copy = async (entries: CollectionEntry[]): Promise<void> => {
            for (const entry of entries) {
                const destination = target + entry.path.slice(entryPath.length);

                if (entry.kind === 'directory') {
                    await this.store.createDirectory(root, destination);
                    await copy(entry.children);
                } else {
                    await this.store.writeFile(root, destination, await this.store.readBytes(root, entry.path), { createOnly: true });
                }
            }
        };

        await this.store.createDirectory(root, target);
        await copy(source.children);
        this.emitChanged(id);

        return target;
    }

    /**
     * Renomeia a requisição (o `name` no arquivo e o próprio arquivo, que segue o slug do nome)
     * ou a pasta (o diretório). Retorna o novo caminho.
     */
    async rename(id: EntityId, entryPath: string, name: string): Promise<string> {
        this.assertNotManifest(entryPath);

        const root = this.resolve(id).path;
        const parent = parentOf(entryPath);

        if (this.format.isRequestFile(path.posix.basename(entryPath))) {
            const request = this.format.parseRequest(await this.store.readFile(root, entryPath));
            const renamed = requestName(name);
            const target = await this.availablePath(root, parent, (suffix) => this.format.requestFileName(slugify(renamed, 'request') + suffix), entryPath);

            await this.store.writeFile(root, entryPath, this.format.serializeRequest({ ...request, name: renamed }));

            if (target !== entryPath) {
                await this.store.move(root, entryPath, target);
            }

            this.emitChanged(id);

            return target;
        }

        const target = joinRelative(parent, folderName(name));

        if (target !== entryPath) {
            this.assertNotManifest(target);
            await this.store.move(root, entryPath, target);
            this.emitChanged(id);
        }

        return target;
    }

    /**
     * Grava a ordem dos itens de uma mesma pasta: o `seq` de cada requisição e o
     * `_folder.yaml` de cada pasta, na ordem recebida (1, 2, 3…). Só regrava o que mudou;
     * arquivos de requisição inválidos são ignorados.
     */
    async reorder(id: EntityId, entries: string[]): Promise<void> {
        const root = this.resolve(id).path;
        const parents = new Set(entries.map((entry) => path.posix.dirname(entry)));

        if (parents.size > 1) {
            throw new Error('Only items of the same folder can be reordered together');
        }

        for (const [index, entry] of entries.entries()) {
            const seq = index + 1;

            this.assertNotManifest(entry);

            if (this.format.isRequestFile(path.posix.basename(entry))) {
                let request: RequestDefinition;

                try {
                    request = this.format.parseRequest(await this.store.readFile(root, entry));
                } catch {
                    continue;
                }

                if (request.seq !== seq) {
                    await this.store.writeFile(root, entry, this.format.serializeRequest({ ...request, seq }));
                }
            } else if (await this.store.exists(root, entry)) {
                const file = joinRelative(entry, this.format.folderFile);

                if ((await this.readFolder(root, entry)).seq !== seq) {
                    await this.store.writeFile(root, file, this.format.serializeFolder({ seq }));
                }
            }
        }

        this.emitChanged(id);
    }

    /** Envia o arquivo ou a pasta para a lixeira do sistema. */
    async remove(id: EntityId, entryPath: string): Promise<void> {
        this.assertNotManifest(entryPath);
        await this.store.remove(this.resolve(id).path, entryPath);
        this.emitChanged(id);
    }

    /** Caminho absoluto do item a mostrar no gerenciador de arquivos; a raiz ('') aponta para o manifesto. */
    revealPath(id: EntityId, entryPath: string): Promise<string> {
        return this.store.absolutePath(this.resolve(id).path, entryPath || this.format.manifestFile);
    }

    /** Para de observar a pasta (a coleção continua registrada no banco). */
    close(id: EntityId): void {
        this.stopWatching(id);
    }

    /** Ao encerrar o app ou trocar de workspace: libera todos os watchers. */
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

    /** Valida o conteúdo de um `otto.yaml` (ex.: de uma coleção sendo importada). */
    parseManifest(content: string): CollectionManifest {
        return this.format.parseManifest(content);
    }

    private async readManifest(root: string): Promise<CollectionManifest> {
        let content: string;

        try {
            content = await this.store.readFile(root, this.format.manifestFile);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw new Error(`"${root}" is not an Otto collection: ${this.format.manifestFile} not found.`);
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
                        return { type: 'folder', name: entry.name, path: entry.path, seq: (await this.readFolder(root, entry.path)).seq, children: await toNodes(entry.children) };
                    }

                    if (!this.format.isRequestFile(entry.name)) {
                        return null;
                    }

                    try {
                        const request = this.format.parseRequest(await this.store.readFile(root, entry.path));

                        return { type: 'request', id: request.id ?? null, name: request.name, path: entry.path, method: request.method, seq: request.seq, error: null };
                    } catch (error) {
                        // Arquivo inválido continua visível na árvore para o usuário corrigir.
                        return { type: 'request', id: null, name: entry.name, path: entry.path, method: null, seq: null, error: error instanceof Error ? error.message : String(error) };
                    }
                })
            );

            return nodes.filter((node): node is CollectionNode => node !== null).sort(byOrder);
        };

        return { root, name, children: await toNodes(await this.store.list(root)) };
    }

    /** Metadados da pasta; ausentes ou inválidos contam como sem ordem definida. */
    private async readFolder(root: string, folder: string): Promise<FolderMetadata> {
        try {
            return this.format.parseFolder(await this.store.readFile(root, joinRelative(folder, this.format.folderFile)));
        } catch {
            return { seq: null };
        }
    }

    /** Primeiro caminho livre na pasta; `current` (o próprio arquivo, ao renomear) conta como livre. */
    private async availablePath(root: string, folder: string, fileName: (suffix: string) => string, current?: string): Promise<string> {
        for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
            const candidate = joinRelative(folder, fileName(attempt === 1 ? '' : `-${attempt}`));

            if (candidate === current || !(await this.store.exists(root, candidate))) {
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
