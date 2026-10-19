import type { Migration } from '../../../core/contracts';

/**
 * Workspaces: o workspace local padrão (`default`, sem pasta) recebe as coleções
 * que estavam abertas, as abas e os ambientes globais. A participação das coleções
 * passa para `workspace_collections` (uma coleção pode estar em mais de um workspace),
 * substituindo `collections_metadata.is_open`.
 */
export const workspaces: Migration = {
    version: 3,
    name: 'workspaces',
    up(db) {
        db.exec(`
            CREATE TABLE workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT UNIQUE,
                last_opened_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            INSERT INTO workspaces (id, name, path, last_opened_at, created_at, updated_at)
            VALUES ('default', 'My Workspace', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

            CREATE TABLE workspace_collections (
                workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
                collection_id TEXT NOT NULL REFERENCES collections_metadata (id) ON DELETE CASCADE,
                position INTEGER NOT NULL,
                PRIMARY KEY (workspace_id, collection_id)
            );

            CREATE INDEX idx_workspace_collections_collection ON workspace_collections (collection_id);

            INSERT INTO workspace_collections (workspace_id, collection_id, position)
            SELECT 'default', id, ROW_NUMBER() OVER (ORDER BY last_opened_at, rowid) - 1 FROM collections_metadata WHERE is_open = 1;

            ALTER TABLE collections_metadata DROP COLUMN is_open;

            ALTER TABLE tabs ADD COLUMN workspace_id TEXT REFERENCES workspaces (id) ON DELETE CASCADE;
            UPDATE tabs SET workspace_id = 'default';

            ALTER TABLE environments ADD COLUMN workspace_id TEXT REFERENCES workspaces (id) ON DELETE CASCADE;
            UPDATE environments SET workspace_id = 'default' WHERE collection_id IS NULL;
            CREATE INDEX idx_environments_workspace ON environments (workspace_id);
        `);
    }
};
