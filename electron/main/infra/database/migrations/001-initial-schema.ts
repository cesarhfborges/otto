import type { Migration } from '../../../core/contracts';

/** Schema inicial: preferências, metadados de coleções, ambientes, histórico e abas. */
export const initialSchema: Migration = {
    version: 1,
    name: 'initial-schema',
    up(db) {
        db.exec(`
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE collections_metadata (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                source TEXT,
                last_opened_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE environments (
                id TEXT PRIMARY KEY,
                collection_id TEXT REFERENCES collections_metadata (id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                variables TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX idx_environments_collection ON environments (collection_id);

            CREATE TABLE history (
                id TEXT PRIMARY KEY,
                collection_id TEXT REFERENCES collections_metadata (id) ON DELETE SET NULL,
                request_path TEXT,
                method TEXT NOT NULL,
                url TEXT NOT NULL,
                status INTEGER,
                error TEXT,
                time_ms INTEGER NOT NULL,
                size_bytes INTEGER NOT NULL,
                executed_at TEXT NOT NULL
            );

            CREATE INDEX idx_history_executed_at ON history (executed_at DESC);
            CREATE INDEX idx_history_collection ON history (collection_id, executed_at DESC);

            CREATE TABLE tabs (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                resource_ref TEXT,
                position INTEGER NOT NULL,
                active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
                draft TEXT
            );
        `);
    }
};
