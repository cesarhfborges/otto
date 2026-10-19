import type { Migration } from '../../../core/contracts';

/** Abas vinculadas a coleções e coleções abertas na barra lateral (restauradas ao iniciar). */
export const workspaceState: Migration = {
    version: 2,
    name: 'workspace-state',
    up(db) {
        db.exec(`
            ALTER TABLE tabs ADD COLUMN collection_id TEXT REFERENCES collections_metadata (id) ON DELETE CASCADE;
            ALTER TABLE collections_metadata ADD COLUMN is_open INTEGER NOT NULL DEFAULT 0 CHECK (is_open IN (0, 1));
        `);
    }
};
