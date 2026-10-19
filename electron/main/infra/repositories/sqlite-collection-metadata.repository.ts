import type { DatabaseSync } from 'node:sqlite';
import type { CollectionMetadata, CollectionSource, EntityId, NewCollectionMetadata } from '../../../shared/models';
import type { IClock, ICollectionMetadataRepository, IIdGenerator } from '../../core/contracts';
import { fromSqlJson, toSqlBool, toSqlJson, toSqlNullable } from '../database/sqlite';

interface CollectionRow {
    id: string;
    name: string;
    path: string;
    source: string | null;
    last_opened_at: string | null;
    is_open: number;
    created_at: string;
    updated_at: string;
}

const toCollection = (row: CollectionRow): CollectionMetadata => ({
    id: row.id,
    name: row.name,
    path: row.path,
    source: fromSqlJson<CollectionSource | null>(row.source, null),
    lastOpenedAt: row.last_opened_at,
    open: row.is_open === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
});

export class SqliteCollectionMetadataRepository implements ICollectionMetadataRepository {
    constructor(
        private readonly db: DatabaseSync,
        private readonly clock: IClock,
        private readonly ids: IIdGenerator
    ) {}

    findById(id: EntityId): CollectionMetadata | null {
        const row = this.db.prepare('SELECT * FROM collections_metadata WHERE id = ?').get(id) as CollectionRow | undefined;

        return row ? toCollection(row) : null;
    }

    findByPath(path: string): CollectionMetadata | null {
        const row = this.db.prepare('SELECT * FROM collections_metadata WHERE path = ?').get(path) as CollectionRow | undefined;

        return row ? toCollection(row) : null;
    }

    /** Ordena pelas abertas mais recentemente. */
    findAll(): CollectionMetadata[] {
        const rows = this.db.prepare('SELECT * FROM collections_metadata ORDER BY last_opened_at IS NULL, last_opened_at DESC, name COLLATE NOCASE').all() as unknown as CollectionRow[];

        return rows.map(toCollection);
    }

    create(input: NewCollectionMetadata): CollectionMetadata {
        if (this.findByPath(input.path)) {
            throw new Error(`A collection is already registered at "${input.path}"`);
        }

        const now = this.clock.now();
        const created: CollectionMetadata = { ...input, id: this.ids.next(), createdAt: now, updatedAt: now };

        this.db
            .prepare('INSERT INTO collections_metadata (id, name, path, source, last_opened_at, is_open, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(created.id, created.name, created.path, toSqlJson(created.source), toSqlNullable(created.lastOpenedAt), toSqlBool(created.open), created.createdAt, created.updatedAt);

        return created;
    }

    update(id: EntityId, patch: Partial<NewCollectionMetadata>): CollectionMetadata | null {
        const current = this.findById(id);

        if (!current) {
            return null;
        }

        const updated: CollectionMetadata = { ...current, ...patch, id, updatedAt: this.clock.now() };
        const owner = updated.path !== current.path ? this.findByPath(updated.path) : null;

        if (owner) {
            throw new Error(`A collection is already registered at "${updated.path}"`);
        }

        this.db
            .prepare('UPDATE collections_metadata SET name = ?, path = ?, source = ?, last_opened_at = ?, is_open = ?, updated_at = ? WHERE id = ?')
            .run(updated.name, updated.path, toSqlJson(updated.source), toSqlNullable(updated.lastOpenedAt), toSqlBool(updated.open), updated.updatedAt, id);

        return updated;
    }

    delete(id: EntityId): boolean {
        return Number(this.db.prepare('DELETE FROM collections_metadata WHERE id = ?').run(id).changes) > 0;
    }
}
