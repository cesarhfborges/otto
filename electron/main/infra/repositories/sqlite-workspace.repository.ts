import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_WORKSPACE_ID, type EntityId, type Workspace } from '../../../shared/models';
import type { IClock, IIdGenerator, IWorkspaceRepository, NewWorkspace } from '../../core/contracts';
import { toSqlNullable, transaction } from '../database/sqlite';

interface WorkspaceRow {
    id: string;
    name: string;
    path: string | null;
    last_opened_at: string | null;
    created_at: string;
    updated_at: string;
}

const toWorkspace = (row: WorkspaceRow): Workspace => ({
    id: row.id,
    name: row.name,
    path: row.path,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
});

export class SqliteWorkspaceRepository implements IWorkspaceRepository {
    constructor(
        private readonly db: DatabaseSync,
        private readonly clock: IClock,
        private readonly ids: IIdGenerator
    ) {}

    findById(id: EntityId): Workspace | null {
        const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined;

        return row ? toWorkspace(row) : null;
    }

    findByPath(path: string): Workspace | null {
        const row = this.db.prepare('SELECT * FROM workspaces WHERE path = ?').get(path) as WorkspaceRow | undefined;

        return row ? toWorkspace(row) : null;
    }

    findAll(): Workspace[] {
        const rows = this.db.prepare('SELECT * FROM workspaces ORDER BY id <> ?, name COLLATE NOCASE, rowid').all(DEFAULT_WORKSPACE_ID) as unknown as WorkspaceRow[];

        return rows.map(toWorkspace);
    }

    create(input: NewWorkspace): Workspace {
        if (input.path && this.findByPath(input.path)) {
            throw new Error(`A workspace is already registered at "${input.path}"`);
        }

        const now = this.clock.now();
        const created: Workspace = { ...input, id: this.ids.next(), lastOpenedAt: null, createdAt: now, updatedAt: now };

        this.db.prepare('INSERT INTO workspaces (id, name, path, last_opened_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(created.id, created.name, toSqlNullable(created.path), null, created.createdAt, created.updatedAt);

        return created;
    }

    update(id: EntityId, patch: Partial<Pick<Workspace, 'name' | 'path' | 'lastOpenedAt'>>): Workspace | null {
        const current = this.findById(id);

        if (!current) {
            return null;
        }

        const updated: Workspace = { ...current, ...patch, id, updatedAt: this.clock.now() };

        this.db.prepare('UPDATE workspaces SET name = ?, path = ?, last_opened_at = ?, updated_at = ? WHERE id = ?').run(updated.name, toSqlNullable(updated.path), toSqlNullable(updated.lastOpenedAt), updated.updatedAt, id);

        return updated;
    }

    delete(id: EntityId): boolean {
        if (id === DEFAULT_WORKSPACE_ID) {
            throw new Error('The default workspace cannot be removed');
        }

        return Number(this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id).changes) > 0;
    }

    active(): Workspace {
        const row = this.db.prepare('SELECT * FROM workspaces ORDER BY last_opened_at IS NULL, last_opened_at DESC, id = ? DESC LIMIT 1').get(DEFAULT_WORKSPACE_ID) as WorkspaceRow | undefined;

        if (!row) {
            throw new Error('No workspace found (database not migrated?)');
        }

        return toWorkspace(row);
    }

    collectionIds(workspaceId: EntityId): EntityId[] {
        const rows = this.db.prepare('SELECT collection_id FROM workspace_collections WHERE workspace_id = ? ORDER BY position, rowid').all(workspaceId) as unknown as Array<{ collection_id: string }>;

        return rows.map((row) => row.collection_id);
    }

    setCollections(workspaceId: EntityId, collectionIds: EntityId[]): void {
        transaction(this.db, () => {
            this.db.prepare('DELETE FROM workspace_collections WHERE workspace_id = ?').run(workspaceId);

            const insert = this.db.prepare('INSERT OR IGNORE INTO workspace_collections (workspace_id, collection_id, position) VALUES (?, ?, ?)');

            collectionIds.forEach((collectionId, position) => insert.run(workspaceId, collectionId, position));
        });
    }

    addCollection(workspaceId: EntityId, collectionId: EntityId): void {
        this.db
            .prepare(
                `INSERT OR IGNORE INTO workspace_collections (workspace_id, collection_id, position)
                 VALUES (?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM workspace_collections WHERE workspace_id = ?))`
            )
            .run(workspaceId, collectionId, workspaceId);
    }

    removeCollection(workspaceId: EntityId, collectionId: EntityId): boolean {
        return Number(this.db.prepare('DELETE FROM workspace_collections WHERE workspace_id = ? AND collection_id = ?').run(workspaceId, collectionId).changes) > 0;
    }
}
