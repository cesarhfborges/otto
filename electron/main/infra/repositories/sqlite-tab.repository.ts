import type { DatabaseSync } from 'node:sqlite';
import type { TabKind, TabState } from '../../../shared/models';
import type { ITabRepository } from '../../core/contracts';
import { toSqlBool, toSqlNullable, transaction } from '../database/sqlite';

interface TabRow {
    id: string;
    kind: string;
    title: string;
    resource_ref: string | null;
    position: number;
    active: number;
    draft: string | null;
}

const toTab = (row: TabRow): TabState => ({
    id: row.id,
    kind: row.kind as TabKind,
    title: row.title,
    resourceRef: row.resource_ref,
    position: row.position,
    active: row.active === 1,
    draft: row.draft
});

export class SqliteTabRepository implements ITabRepository {
    constructor(private readonly db: DatabaseSync) {}

    list(): TabState[] {
        const rows = this.db.prepare('SELECT * FROM tabs ORDER BY position, rowid').all() as unknown as TabRow[];

        return rows.map(toTab);
    }

    replaceAll(tabs: TabState[]): void {
        transaction(this.db, () => {
            this.db.exec('DELETE FROM tabs');

            const insert = this.db.prepare('INSERT INTO tabs (id, kind, title, resource_ref, position, active, draft) VALUES (?, ?, ?, ?, ?, ?, ?)');

            for (const tab of tabs) {
                insert.run(tab.id, tab.kind, tab.title, toSqlNullable(tab.resourceRef), tab.position, toSqlBool(tab.active), toSqlNullable(tab.draft));
            }
        });
    }
}
