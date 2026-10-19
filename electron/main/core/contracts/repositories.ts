import type { CollectionMetadata, EntityId, Environment, HistoryEntry, HistoryQuery, NewCollectionMetadata, NewEnvironment, NewHistoryEntry, TabState, Workspace } from '../../../shared/models';
import type { IRepository } from './repository';

/** Histórico é append-only: não há `update`. */
export interface IHistoryRepository {
    add(entry: NewHistoryEntry): HistoryEntry;
    list(query?: HistoryQuery): HistoryEntry[];
    delete(id: EntityId): boolean;
    /** Remove todo o histórico e retorna quantos registros foram apagados. */
    clear(): number;
    /** Mantém só os `keep` registros mais recentes; retorna quantos foram apagados. */
    prune(keep: number): number;
}

/** Abas abertas, por workspace. */
export interface ITabRepository {
    list(workspaceId: EntityId): TabState[];
    /** Substitui o conjunto de abas do workspace de forma atômica. */
    replaceAll(workspaceId: EntityId, tabs: TabState[]): void;
}

/** Ambientes de coleção ou globais; os globais pertencem a um workspace. */
export interface IEnvironmentRepository extends IRepository<Environment, EntityId, NewEnvironment> {
    /** `null` lista os ambientes globais do workspace. */
    findByCollection(collectionId: EntityId | null, workspaceId?: EntityId): Environment[];
    /** `workspaceId` é gravado nos ambientes globais (`collectionId = null`). */
    create(input: NewEnvironment, workspaceId?: EntityId): Environment;
    update(id: EntityId, patch: Partial<NewEnvironment>, workspaceId?: EntityId): Environment | null;
}

export type NewWorkspace = Pick<Workspace, 'name' | 'path'>;

export interface IWorkspaceRepository {
    findById(id: EntityId): Workspace | null;
    findByPath(path: string): Workspace | null;
    /** O padrão primeiro; os demais por nome. */
    findAll(): Workspace[];
    create(input: NewWorkspace): Workspace;
    update(id: EntityId, patch: Partial<Pick<Workspace, 'name' | 'path' | 'lastOpenedAt'>>): Workspace | null;
    delete(id: EntityId): boolean;
    /** O aberto mais recentemente (o padrão, se nenhum tiver data). */
    active(): Workspace;
    /** Coleções do workspace, na ordem da barra lateral. */
    collectionIds(workspaceId: EntityId): EntityId[];
    /** Substitui a lista de coleções (ex.: ao reler o `workspace.yaml`). */
    setCollections(workspaceId: EntityId, collectionIds: EntityId[]): void;
    addCollection(workspaceId: EntityId, collectionId: EntityId): void;
    removeCollection(workspaceId: EntityId, collectionId: EntityId): boolean;
}

export interface ICollectionMetadataRepository extends IRepository<CollectionMetadata, EntityId, NewCollectionMetadata> {
    findByPath(path: string): CollectionMetadata | null;
}
