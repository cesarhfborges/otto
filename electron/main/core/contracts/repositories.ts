import type { CollectionMetadata, EntityId, Environment, HistoryEntry, HistoryQuery, NewCollectionMetadata, NewEnvironment, NewHistoryEntry, TabState } from '../../../shared/models';
import type { IRepository } from './repository';

/** Histórico é append-only: não há `update`. */
export interface IHistoryRepository {
    add(entry: NewHistoryEntry): HistoryEntry;
    list(query?: HistoryQuery): HistoryEntry[];
    delete(id: EntityId): boolean;
    /** Remove todo o histórico e retorna quantos registros foram apagados. */
    clear(): number;
}

export interface ITabRepository {
    list(): TabState[];
    /** Substitui o conjunto de abas abertas de forma atômica. */
    replaceAll(tabs: TabState[]): void;
}

export interface IEnvironmentRepository extends IRepository<Environment, EntityId, NewEnvironment> {
    /** `null` lista os ambientes globais. */
    findByCollection(collectionId: EntityId | null): Environment[];
}

export interface ICollectionMetadataRepository extends IRepository<CollectionMetadata, EntityId, NewCollectionMetadata> {
    findByPath(path: string): CollectionMetadata | null;
}
