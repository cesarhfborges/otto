import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_WORKSPACE_ID, type EntityId, type Environment, type EnvironmentVariable, type NewEnvironment } from '../../../shared/models';
import type { IClock, IEnvironmentRepository, IIdGenerator } from '../../core/contracts';
import { fromSqlJson, toSqlNullable } from '../database/sqlite';

interface EnvironmentRow {
    id: string;
    collection_id: string | null;
    name: string;
    variables: string;
    created_at: string;
    updated_at: string;
}

const toEnvironment = (row: EnvironmentRow): Environment => ({
    id: row.id,
    collectionId: row.collection_id,
    name: row.name,
    variables: fromSqlJson<EnvironmentVariable[]>(row.variables, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
});

export class SqliteEnvironmentRepository implements IEnvironmentRepository {
    constructor(
        private readonly db: DatabaseSync,
        private readonly clock: IClock,
        private readonly ids: IIdGenerator
    ) {}

    findById(id: EntityId): Environment | null {
        const row = this.db.prepare('SELECT * FROM environments WHERE id = ?').get(id) as EnvironmentRow | undefined;

        return row ? toEnvironment(row) : null;
    }

    findAll(): Environment[] {
        return (this.db.prepare('SELECT * FROM environments ORDER BY name COLLATE NOCASE, rowid').all() as unknown as EnvironmentRow[]).map(toEnvironment);
    }

    findByCollection(collectionId: EntityId | null, workspaceId: EntityId = DEFAULT_WORKSPACE_ID): Environment[] {
        const rows =
            collectionId === null
                ? this.db.prepare('SELECT * FROM environments WHERE collection_id IS NULL AND workspace_id = ? ORDER BY name COLLATE NOCASE, rowid').all(workspaceId)
                : this.db.prepare('SELECT * FROM environments WHERE collection_id = ? ORDER BY name COLLATE NOCASE, rowid').all(collectionId);

        return (rows as unknown as EnvironmentRow[]).map(toEnvironment);
    }

    create(input: NewEnvironment, workspaceId: EntityId = DEFAULT_WORKSPACE_ID): Environment {
        const now = this.clock.now();
        const created: Environment = { ...input, id: this.ids.next(), createdAt: now, updatedAt: now };

        this.db
            .prepare('INSERT INTO environments (id, collection_id, workspace_id, name, variables, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(created.id, toSqlNullable(created.collectionId), created.collectionId === null ? workspaceId : null, created.name, JSON.stringify(created.variables), created.createdAt, created.updatedAt);

        return created;
    }

    update(id: EntityId, patch: Partial<NewEnvironment>, workspaceId: EntityId = DEFAULT_WORKSPACE_ID): Environment | null {
        const current = this.findById(id);

        if (!current) {
            return null;
        }

        const updated: Environment = { ...current, ...patch, id, updatedAt: this.clock.now() };

        // Ao virar global, o ambiente passa a pertencer ao workspace indicado; global que continua global mantém o seu.
        this.db
            .prepare('UPDATE environments SET collection_id = ?, workspace_id = CASE WHEN ? IS NOT NULL THEN NULL ELSE COALESCE(workspace_id, ?) END, name = ?, variables = ?, updated_at = ? WHERE id = ?')
            .run(toSqlNullable(updated.collectionId), toSqlNullable(updated.collectionId), workspaceId, updated.name, JSON.stringify(updated.variables), updated.updatedAt, id);

        return updated;
    }

    delete(id: EntityId): boolean {
        return Number(this.db.prepare('DELETE FROM environments WHERE id = ?').run(id).changes) > 0;
    }
}
