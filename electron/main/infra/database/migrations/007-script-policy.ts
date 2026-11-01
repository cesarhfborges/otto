import type { Migration } from '../../../core/contracts';

/**
 * Política de segurança dos scripts por coleção: modo (`trusted`/`ask`/`disabled`),
 * permissões personalizadas e a impressão digital + snapshot dos scripts confiados
 * (para voltar a perguntar quando eles mudam e mostrar o diff). `scripts_trusted`
 * (migração 006) vira legado: o SQLite não remove a coluna sem recriar a tabela.
 */
export const scriptPolicy: Migration = {
    version: 7,
    name: 'script-policy',
    up(db) {
        db.exec(`
            ALTER TABLE collections_metadata ADD COLUMN script_mode TEXT NOT NULL DEFAULT 'ask' CHECK (script_mode IN ('trusted', 'ask', 'disabled'));
            UPDATE collections_metadata SET script_mode = CASE scripts_trusted WHEN 1 THEN 'trusted' ELSE 'ask' END;
            ALTER TABLE collections_metadata ADD COLUMN script_permissions TEXT;
            ALTER TABLE collections_metadata ADD COLUMN trusted_fingerprint TEXT;
            ALTER TABLE collections_metadata ADD COLUMN trusted_at TEXT;

            CREATE TABLE trusted_scripts (
                collection_id TEXT NOT NULL REFERENCES collections_metadata (id) ON DELETE CASCADE,
                location TEXT NOT NULL CHECK (location IN ('collection', 'folder', 'request')),
                path TEXT NOT NULL,
                phase TEXT NOT NULL CHECK (phase IN ('preRequest', 'postResponse')),
                code TEXT NOT NULL,
                PRIMARY KEY (collection_id, location, path, phase)
            );
        `);
    }
};
