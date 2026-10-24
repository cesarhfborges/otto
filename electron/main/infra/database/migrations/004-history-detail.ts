import type { Migration } from '../../../core/contracts';

/** Histórico guarda a requisição e a resposta (JSON) para rever e comparar execuções. */
export const historyDetail: Migration = {
    version: 4,
    name: 'history-detail',
    up(db) {
        db.exec(`
            ALTER TABLE history ADD COLUMN detail TEXT;
            CREATE INDEX IF NOT EXISTS idx_history_request ON history (collection_id, request_path);
        `);
    }
};
