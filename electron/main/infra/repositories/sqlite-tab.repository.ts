import type { DatabaseSync } from 'node:sqlite';
import type { EntityId, TabKind, TabState } from '../../../shared/models';
import type { ITabRepository } from '../../core/contracts';
import { toSqlBool, toSqlNullable, transaction } from '../database/sqlite';

interface TabRow {
    id: string;
    kind: string;
    title: string;
    collection_id: string | null;
    resource_ref: string | null;
    position: number;
    active: number;
    draft: string | null;
}

const toTab = (row: TabRow): TabState => ({
    id: row.id,
    kind: row.kind as TabKind,
    title: row.title,
    collectionId: row.collection_id,
    resourceRef: row.resource_ref,
    position: row.position,
    active: row.active === 1,
    draft: row.draft
});

export class SqliteTabRepository implements ITabRepository {
    constructor(private readonly db: DatabaseSync) {}

    list(workspaceId: EntityId): TabState[] {
        const rows = this.db.prepare('SELECT * FROM tabs WHERE workspace_id = ? ORDER BY position, rowid').all(workspaceId) as unknown as TabRow[];

        return rows.map(toTab);
    }

    replaceAll(workspaceId: EntityId, tabs: TabState[]): void {
        transaction(this.db, () => {
            this.db.prepare('DELETE FROM tabs WHERE workspace_id = ?').run(workspaceId);

            const insert = this.db.prepare('INSERT INTO tabs (id, kind, title, collection_id, resource_ref, position, active, draft, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');

            for (const tab of tabs) {
                insert.run(tab.id, tab.kind, tab.title, toSqlNullable(tab.collectionId), toSqlNullable(tab.resourceRef), tab.position, toSqlBool(tab.active), toSqlNullable(tab.draft), workspaceId);
            }
        });
    }
}
