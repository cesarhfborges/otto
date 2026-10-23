import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { DEFAULT_WORKSPACE_ID, WORKSPACE_FORMAT_VERSION, type EntityId, type Environment, type LoadedWorkspace, type OpenedCollection, type Workspace, type WorkspaceManifest, type WorkspaceSummary } from '../../../shared/models';
import type { IClock, ICollectionMetadataRepository, ICollectionStore, IEnvironmentRepository, IWorkspaceFormat, IWorkspaceRepository } from '../../core/contracts';
import { createZip, readZip } from '../../infra/workspaces/zip-archive';
import type { CollectionService } from '../collections/collection.service';
import { ENVIRONMENTS_BACKUP_FILE, restoreEnvironments, serializeEnvironments } from '../collections/environment-backup';
import { slugify } from '../collections/slug';

/** Pasta (dentro do workspace) onde novas coleções são criadas por padrão. */
const COLLECTIONS_FOLDER = 'collections';

/** Leitura/escrita de arquivos fora de uma coleção (arquivo .zip escolhido pelo usuário). */
export interface ArchiveFiles {
    read(file: string): Promise<Uint8Array>;
    write(file: string, content: Uint8Array): Promise<void>;
}

/** Caminho no `workspace.yaml`: relativo com `/` quando a coleção está dentro do workspace; absoluto fora dele. */
function toManifestPath(workspaceRoot: string, collectionPath: string): string {
    const relative = path.relative(workspaceRoot, collectionPath);

    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.split(path.sep).join('/') : collectionPath;
}

function fromManifestPath(workspaceRoot: string, entry: string): string {
    return path.isAbsolute(entry) ? path.normalize(entry) : path.resolve(workspaceRoot, ...entry.split('/'));
}

/** Prefixo comum do .zip quando tudo está numa única pasta (ex.: `team-api/workspace.yaml`). */
function archiveRoot(names: string[], manifestFile: string): string | null {
    if (names.includes(manifestFile)) {
        return '';
    }

    const tops = new Set(names.map((name) => name.split('/')[0]));
    const [top] = tops;

    return tops.size === 1 && names.includes(`${top}/${manifestFile}`) ? `${top}/` : null;
}

/** Compara como ficam no `workspace.yaml` (segredos sem valor). */
const sameEnvironments = (a: WorkspaceManifest['environments'], b: NonNullable<WorkspaceManifest['environments']>): boolean => {
    const plain = (list: NonNullable<WorkspaceManifest['environments']>): string => JSON.stringify(list.map(({ name, variables }) => ({ name, variables: variables.map((variable) => (variable.secret ? { ...variable, value: '' } : variable)) })));

    return !!a && plain(a) === plain(b);
};

/** Manifesto da coleção (`otto.yaml`), procurado na raiz do pacote importado. */
const COLLECTION_MANIFEST = 'otto.yaml';

/**
 * Workspaces são pastas dentro da pasta base (`<base>/<workspace>/collections/<coleção>`),
 * com um `workspace.yaml` que é a fonte da verdade da lista de coleções (o banco guarda
 * uma cópia para ordenar e montar a barra lateral). Entradas do arquivo que não existem
 * neste computador são preservadas ao reescrevê-lo (o arquivo pode ser compartilhado via Git).
 * Workspaces e coleções de fora entram no app só por importação (cópia para a pasta base).
 */
export class WorkspaceService {
    private readonly events = new EventEmitter<{ changed: [] }>();

    constructor(
        private readonly workspaces: IWorkspaceRepository,
        private readonly collections: ICollectionMetadataRepository,
        private readonly collectionService: CollectionService,
        private readonly store: ICollectionStore,
        private readonly format: IWorkspaceFormat,
        private readonly archives: ArchiveFiles,
        private readonly environments: IEnvironmentRepository,
        private readonly clock: IClock,
        /** Pasta base atual (preferência `workspaces.baseDirectory` ou o padrão). */
        private readonly baseDirectory: () => string
    ) {}

    active(): Workspace {
        return this.workspaces.active();
    }

    get(id: EntityId): Workspace {
        return this.require(id);
    }

    list(): Promise<WorkspaceSummary[]> {
        const activeId = this.workspaces.active().id;

        return Promise.all(
            this.workspaces.findAll().map(async (workspace) => ({
                ...workspace,
                active: workspace.id === activeId,
                collectionCount: this.workspaces.collectionIds(workspace.id).length,
                missing: await this.isMissing(workspace)
            }))
        );
    }

    /**
     * Carrega o workspace ativo: relê o `workspace.yaml` (mudanças vindas do Git)
     * e abre as coleções. As que falham (pasta ausente neste computador) vêm em `failed`.
     * Se a pasta do workspace sumiu, nada é aberto e o resultado vem com `missing`
     * (o padrão, que não pode ser removido, é recriado na hora).
     */
    async load(): Promise<LoadedWorkspace> {
        let workspace = await this.ensureFolder(this.workspaces.active());
        const failed: LoadedWorkspace['failed'] = [];

        this.collectionService.closeAll();

        if (await this.isMissing(workspace)) {
            if (workspace.id !== DEFAULT_WORKSPACE_ID) {
                return { workspace, collections: [], failed, missing: true, collectionsLocation: null };
            }

            workspace = await this.recreateFolder(workspace);
        }

        failed.push(...(await this.syncFromManifest(workspace)));

        const opened: OpenedCollection[] = [];

        for (const id of this.workspaces.collectionIds(workspace.id)) {
            const metadata = this.collections.findById(id);

            if (!metadata) {
                continue;
            }

            try {
                opened.push(await this.collectionService.open(metadata.path));
            } catch (error) {
                failed.push({ path: metadata.path, error: error instanceof Error ? error.message : String(error) });
            }
        }

        return { workspace, collections: opened, failed, missing: false, collectionsLocation: workspace.path ? path.join(workspace.path, COLLECTIONS_FOLDER) : null };
    }

    switch(id: EntityId): Workspace {
        const workspace = this.workspaces.update(id, { lastOpenedAt: this.clock.now() });

        if (!workspace) {
            throw new Error(`Workspace "${id}" not found`);
        }

        this.emitChanged();

        return workspace;
    }

    /** Cria `<base>/<slug>` com `workspace.yaml` e a pasta `collections/`, e ativa. */
    async create(name: string): Promise<Workspace> {
        const root = await this.newWorkspaceFolder(name);

        await this.writeNewWorkspace(root, name, []);

        return this.switch(this.workspaces.create({ name, path: root }).id);
    }

    /** Cria `<workspace ativo>/collections/<slug>` e inclui no workspace. */
    async createCollection(name: string): Promise<OpenedCollection> {
        const workspace = await this.activeFolder();
        const created = await this.collectionService.create(path.join(workspace.path!, COLLECTIONS_FOLDER), name);

        await this.addCollection(created.metadata.id);

        return created;
    }

    /**
     * Restaura um backup do Otto (.zip gerado por `exportCollection`) em
     * `<workspace ativo>/collections/<slug do nome>`, recria os ambientes e inclui no workspace.
     */
    async importCollection(file: string): Promise<OpenedCollection> {
        const workspace = await this.activeFolder();
        const files = readZip(await this.archives.read(file));
        const prefix = archiveRoot([...files.keys()], COLLECTION_MANIFEST);

        if (prefix === null) {
            throw new Error(`No ${COLLECTION_MANIFEST} found: this is not an Otto backup`);
        }

        const environments = files.get(prefix + ENVIRONMENTS_BACKUP_FILE);

        const manifest = this.collectionService.parseManifest(new TextDecoder().decode(files.get(prefix + COLLECTION_MANIFEST)));
        const root = path.join(workspace.path!, COLLECTIONS_FOLDER, slugify(manifest.name, 'collection'));

        if (await this.store.isDirectory(root)) {
            throw new Error(`This workspace already has a collection folder named "${path.basename(root)}". Rename or remove it first.`);
        }

        await this.store.createRoot(root);

        for (const [name, content] of files) {
            if (name.startsWith(prefix) && name !== prefix + ENVIRONMENTS_BACKUP_FILE) {
                await this.store.writeFile(root, name.slice(prefix.length), content, { createOnly: true });
            }
        }

        const opened = await this.collectionService.open(root);

        if (environments) {
            restoreEnvironments(environments, this.environments, opened.metadata.id);
        }

        await this.addCollection(opened.metadata.id);

        return opened;
    }

    /** Backup .zip: arquivos da coleção (`otto.yaml` na raiz) + ambientes da coleção. */
    async exportCollection(id: EntityId, file: string): Promise<void> {
        await this.archives.write(file, createZip(await this.collectionFiles(id)));
    }

    async rename(id: EntityId, name: string): Promise<Workspace> {
        const workspace = this.require(id);

        // Sem a pasta, renomeia só na lista (o `workspace.yaml` é recriado com o nome atual).
        if (workspace.path && !(await this.isMissing(workspace))) {
            await this.updateManifest(workspace, (manifest) => ({ ...manifest, name }));
        }

        const updated = this.workspaces.update(id, { name })!;

        this.emitChanged();

        return updated;
    }

    /** Tira o workspace da lista (a pasta no disco não é apagada). O padrão não pode ser removido. */
    remove(id: EntityId): void {
        this.require(id);

        if (id === DEFAULT_WORKSPACE_ID) {
            throw new Error('The default workspace cannot be removed');
        }

        if (this.workspaces.active().id === id) {
            this.switch(DEFAULT_WORKSPACE_ID);
        }

        this.workspaces.delete(id);
        this.emitChanged();
    }

    /** Recria a pasta e o `workspace.yaml` (com as coleções que ainda existem) de um workspace cuja pasta sumiu. */
    async recreate(id: EntityId): Promise<Workspace> {
        const workspace = await this.ensureFolder(this.require(id));
        const recreated = (await this.isMissing(workspace)) ? await this.recreateFolder(workspace) : workspace;

        this.emitChanged();

        return recreated;
    }

    /** Inclui a coleção no workspace ativo (e no `workspace.yaml`, se houver). */
    async addCollection(collectionId: EntityId): Promise<void> {
        const workspace = this.workspaces.active();
        const collection = this.collections.findById(collectionId);

        if (!collection) {
            throw new Error(`Collection "${collectionId}" not found`);
        }

        this.workspaces.addCollection(workspace.id, collectionId);

        if (workspace.path) {
            const entry = toManifestPath(workspace.path, collection.path);

            await this.updateManifest(workspace, (manifest) => (manifest.collections.some((c) => fromManifestPath(workspace.path!, c.path) === collection.path) ? manifest : { ...manifest, collections: [...manifest.collections, { path: entry }] }));
        }

        this.emitChanged();
    }

    /** Tira a coleção do workspace ativo (a pasta da coleção não é apagada). */
    async removeCollection(collectionId: EntityId): Promise<void> {
        const workspace = this.workspaces.active();
        const collection = this.collections.findById(collectionId);

        this.workspaces.removeCollection(workspace.id, collectionId);
        this.collectionService.close(collectionId);

        if (workspace.path && collection) {
            await this.updateManifest(workspace, (manifest) => ({ ...manifest, collections: manifest.collections.filter((c) => fromManifestPath(workspace.path!, c.path) !== collection.path) }));
        }

        this.emitChanged();
    }

    /** Tira a coleção do workspace ativo, envia a pasta para a lixeira e esquece a coleção no app. */
    async trashCollection(collectionId: EntityId): Promise<void> {
        const collection = this.collections.findById(collectionId);

        if (!collection) {
            throw new Error(`Collection "${collectionId}" not found`);
        }

        await this.removeCollection(collectionId);
        await this.store.removeRoot(collection.path);
        this.collections.delete(collectionId);
    }

    /**
     * Gera um .zip autocontido: `workspace.yaml` + `collections/<pasta>/...` de cada
     * coleção (inclusive as que estão fora da pasta do workspace).
     */
    async export(id: EntityId, file: string): Promise<void> {
        const workspace = this.require(id);
        const files = new Map<string, Uint8Array>();
        const entries: WorkspaceManifest['collections'] = [];
        const used = new Set<string>();

        for (const collectionId of this.workspaces.collectionIds(id)) {
            const collection = this.collections.findById(collectionId);

            if (!collection || !(await this.store.isDirectory(collection.path))) {
                continue;
            }

            const base = slugify(path.basename(collection.path), 'collection');
            let folder = base;

            for (let n = 2; used.has(folder); n++) {
                folder = `${base}-${n}`;
            }

            used.add(folder);
            entries.push({ path: `${COLLECTIONS_FOLDER}/${folder}` });

            for (const [relative, content] of await this.collectionFiles(collectionId)) {
                files.set(`${COLLECTIONS_FOLDER}/${folder}/${relative}`, content);
            }
        }

        files.set(this.format.manifestFile, new TextEncoder().encode(this.format.serializeManifest({ version: WORKSPACE_FORMAT_VERSION, name: workspace.name, collections: entries })));
        files.set(ENVIRONMENTS_BACKUP_FILE, serializeEnvironments(this.environments.findByCollection(null, id)));
        await this.archives.write(file, createZip(files));
    }

    /** Extrai o .zip em `<base>/<slug do nome>` e ativa o workspace. */
    async import(file: string): Promise<Workspace> {
        const files = readZip(await this.archives.read(file));
        const prefix = archiveRoot([...files.keys()], this.format.manifestFile);

        if (prefix === null) {
            throw new Error(`The archive does not contain a ${this.format.manifestFile}`);
        }

        const manifest = this.format.parseManifest(new TextDecoder().decode(files.get(prefix + this.format.manifestFile)));
        const root = await this.newWorkspaceFolder(manifest.name);

        await this.store.createRoot(root);

        // Backups de ambientes (`otto-environments.json`) não vão para o disco: são recriados no banco.
        const environments = new Map<string, Uint8Array>();

        for (const [name, content] of files) {
            if (!name.startsWith(prefix) || name === prefix + this.format.manifestFile) {
                continue;
            }

            const relative = name.slice(prefix.length);

            if (path.posix.basename(relative) === ENVIRONMENTS_BACKUP_FILE) {
                environments.set(path.posix.dirname(relative), content);
            } else {
                await this.store.writeFile(root, relative, content, { createOnly: true });
            }
        }

        // Só coleções contidas no próprio arquivo: caminhos absolutos ou com `..` apontariam para fora dele.
        const collections = manifest.collections.filter((c) => !path.isAbsolute(c.path) && !c.path.split('/').includes('..'));

        await this.store.writeFile(root, this.format.manifestFile, this.format.serializeManifest({ ...manifest, version: WORKSPACE_FORMAT_VERSION, collections }), { createOnly: true });

        const created = this.workspaces.create({ name: manifest.name, path: root });

        await this.restoreWorkspaceEnvironments(created.id, root, environments, collections);

        return this.switch(created.id);
    }

    onChanged(listener: () => void): () => void {
        this.events.on('changed', listener);

        return () => this.events.off('changed', listener);
    }

    /** `<base>/<slug>`; recusa se a pasta já existir (outro workspace com o mesmo nome). */
    private async newWorkspaceFolder(name: string): Promise<string> {
        const root = path.join(path.resolve(this.baseDirectory()), slugify(name, 'workspace'));

        if (await this.store.isDirectory(root)) {
            throw new Error(`A folder named "${path.basename(root)}" already exists in ${path.dirname(root)}. Choose another name.`);
        }

        return root;
    }

    private async writeNewWorkspace(root: string, name: string, collections: WorkspaceManifest['collections']): Promise<void> {
        await this.store.createRoot(root);
        await this.store.writeFile(root, this.format.manifestFile, this.format.serializeManifest({ version: WORKSPACE_FORMAT_VERSION, name, collections }), { createOnly: true });
        await this.store.createDirectory(root, COLLECTIONS_FOLDER);
    }

    /**
     * Workspaces sem pasta (o "My Workspace" de versões anteriores) ganham uma em
     * `<base>/<slug>`; as coleções que ele já tinha continuam onde estão (caminhos absolutos).
     */
    private async ensureFolder(workspace: Workspace): Promise<Workspace> {
        if (workspace.path) {
            return workspace;
        }

        const base = path.resolve(this.baseDirectory());
        const slug = slugify(workspace.name, 'workspace');
        let root = path.join(base, slug);

        for (let n = 2; await this.store.isDirectory(root); n++) {
            root = path.join(base, `${slug}-${n}`);
        }

        const collections = this.workspaces
            .collectionIds(workspace.id)
            .map((id) => this.collections.findById(id))
            .filter((c) => c !== null)
            .map((c) => ({ path: toManifestPath(root, c.path) }));

        await this.writeNewWorkspace(root, workspace.name, collections);

        return this.workspaces.update(workspace.id, { path: root })!;
    }

    /** A pasta do workspace (ou o `workspace.yaml` dela) não existe mais. */
    private async isMissing(workspace: Workspace): Promise<boolean> {
        return workspace.path !== null && !(await this.store.exists(workspace.path, this.format.manifestFile).catch(() => false));
    }

    /** Workspace ativo com pasta; recusa operações em disco se a pasta sumiu. */
    private async activeFolder(): Promise<Workspace> {
        const workspace = await this.ensureFolder(this.workspaces.active());

        if (await this.isMissing(workspace)) {
            throw new Error(`The folder of the workspace "${workspace.name}" was not found (${workspace.path}). Recreate it or remove the workspace in Manage Workspaces.`);
        }

        return workspace;
    }

    /** Recria `<pasta>/workspace.yaml` e `collections/`; a lista fica só com as coleções cujas pastas ainda existem. */
    private async recreateFolder(workspace: Workspace): Promise<Workspace> {
        const root = workspace.path!;
        const existing = [];

        for (const id of this.workspaces.collectionIds(workspace.id)) {
            const collection = this.collections.findById(id);

            if (collection && (await this.store.isDirectory(collection.path))) {
                existing.push(collection);
            }
        }

        if (!(await this.store.isDirectory(root))) {
            await this.store.createRoot(root);
        }

        await this.store.writeFile(root, this.format.manifestFile, this.format.serializeManifest({ version: WORKSPACE_FORMAT_VERSION, name: workspace.name, collections: existing.map((c) => ({ path: toManifestPath(root, c.path) })) }));

        if (!(await this.store.isDirectory(path.join(root, COLLECTIONS_FOLDER)))) {
            await this.store.createDirectory(root, COLLECTIONS_FOLDER);
        }

        this.workspaces.setCollections(workspace.id, existing.map((c) => c.id));

        return workspace;
    }

    /** Arquivos da coleção + backup dos ambientes dela. */
    private async collectionFiles(id: EntityId): Promise<Map<string, Uint8Array>> {
        const files = await this.collectionService.files(id);

        files.set(ENVIRONMENTS_BACKUP_FILE, serializeEnvironments(this.environments.findByCollection(id)));

        return files;
    }

    /** Recria os ambientes globais (raiz do .zip) e os de cada coleção (pasta da coleção). */
    private async restoreWorkspaceEnvironments(workspaceId: EntityId, root: string, environments: Map<string, Uint8Array>, collections: WorkspaceManifest['collections']): Promise<void> {
        const globals = environments.get('.');

        if (globals) {
            restoreEnvironments(globals, this.environments, null, workspaceId);
        }

        for (const entry of collections) {
            const content = environments.get(entry.path.replace(/\/+$/, ''));

            if (content) {
                try {
                    const { metadata } = await this.collectionService.register(fromManifestPath(root, entry.path));

                    restoreEnvironments(content, this.environments, metadata.id);
                } catch (error) {
                    // Coleção inválida no pacote: aparece como falha ao carregar o workspace.
                    console.warn('[otto] could not restore environments of', entry.path, error);
                }
            }
        }
    }

    /** Registra as coleções listadas no `workspace.yaml` e atualiza a lista do banco. */
    private async syncFromManifest(workspace: Workspace): Promise<LoadedWorkspace['failed']> {
        const root = workspace.path!;
        const failed: LoadedWorkspace['failed'] = [];
        let manifest: WorkspaceManifest;

        try {
            manifest = await this.readManifest(root);
        } catch (error) {
            // Sem o arquivo, mantém a última lista conhecida.
            return [{ path: root, error: error instanceof Error ? error.message : String(error) }];
        }

        const ids: EntityId[] = [];

        for (const entry of manifest.collections) {
            const collectionPath = fromManifestPath(root, entry.path);

            try {
                ids.push((await this.collectionService.register(collectionPath)).metadata.id);
            } catch (error) {
                failed.push({ path: collectionPath, error: error instanceof Error ? error.message : String(error) });
            }
        }

        this.workspaces.setCollections(workspace.id, ids);
        await this.syncEnvironmentsFromManifest(workspace, manifest);

        if (manifest.name && manifest.name !== workspace.name) {
            this.workspaces.update(workspace.id, { name: manifest.name });
        }

        return failed;
    }

    /**
     * Grava os ambientes globais do workspace ativo no `workspace.yaml` (vão para o Git com ele).
     * Chamado sempre que um ambiente global é criado, alterado ou excluído.
     */
    async saveEnvironments(): Promise<void> {
        const workspace = this.workspaces.active();

        if (workspace.path) {
            const environments = this.environments.findByCollection(null, workspace.id).map(({ name, variables }) => ({ name, variables }));

            await this.updateManifest(workspace, (manifest) => (sameEnvironments(manifest.environments, environments) ? manifest : { ...manifest, environments }));
        }
    }

    /**
     * O `workspace.yaml` é a fonte da verdade dos ambientes globais (mudanças vindas do Git):
     * o banco é ajustado pelo nome, mantendo ids (ambiente selecionado) e os valores secretos
     * locais. Arquivo sem a seção (anterior a ela) recebe os ambientes do banco.
     */
    private async syncEnvironmentsFromManifest(workspace: Workspace, manifest: WorkspaceManifest): Promise<void> {
        if (!manifest.environments) {
            await this.saveEnvironments();

            return;
        }

        const current = this.environments.findByCollection(null, workspace.id);
        const byName = new Map<string, Environment>();

        for (const environment of current) {
            if (byName.has(environment.name)) {
                this.environments.delete(environment.id);
            } else {
                byName.set(environment.name, environment);
            }
        }

        for (const { name, variables } of manifest.environments) {
            const existing = byName.get(name);

            byName.delete(name);

            if (!existing) {
                this.environments.create({ collectionId: null, name, variables }, workspace.id);
                continue;
            }

            // Segredo vem vazio do arquivo: vale o valor guardado no cofre desta máquina.
            const merged = variables.map((variable) => (variable.secret && !variable.value ? { ...variable, value: existing.variables.find((local) => local.secret && local.key === variable.key)?.value ?? '' } : variable));

            if (JSON.stringify(merged) !== JSON.stringify(existing.variables)) {
                this.environments.update(existing.id, { variables: merged }, workspace.id);
            }
        }

        for (const leftover of byName.values()) {
            this.environments.delete(leftover.id);
        }
    }

    private async readManifest(root: string): Promise<WorkspaceManifest> {
        if (!(await this.store.isDirectory(root))) {
            throw new Error(`Folder "${root}" does not exist`);
        }

        try {
            return this.format.parseManifest(await this.store.readFile(root, this.format.manifestFile));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw new Error(`"${root}" is not an Otto workspace: ${this.format.manifestFile} not found. Use New Workspace to create one.`);
            }

            throw error;
        }
    }

    private async updateManifest(workspace: Workspace, change: (manifest: WorkspaceManifest) => WorkspaceManifest): Promise<void> {
        const root = workspace.path!;
        const current = await this.readManifest(root);
        const next = change(current);

        if (next !== current) {
            await this.store.writeFile(root, this.format.manifestFile, this.format.serializeManifest(next));
        }
    }

    private require(id: EntityId): Workspace {
        const workspace = this.workspaces.findById(id);

        if (!workspace) {
            throw new Error(`Workspace "${id}" not found`);
        }

        return workspace;
    }

    private emitChanged(): void {
        this.events.emit('changed');
    }
}
