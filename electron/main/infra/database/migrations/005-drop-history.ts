import type { Migration } from '../../../core/contracts';

/**
 * O histórico de requisições passou a viver só em memória (por aba, no renderer):
 * apaga o que versões anteriores gravaram. `secure_delete` zera as páginas liberadas,
 * para que requisições e respostas antigas não fiquem recuperáveis no arquivo do banco.
 */
export const dropHistory: Migration = {
    version: 5,
    name: 'drop-history',
    up(db) {
        db.exec(`
            PRAGMA secure_delete = ON;
            DROP INDEX IF EXISTS idx_history_request;
            DROP INDEX IF EXISTS idx_history_collection;
            DROP INDEX IF EXISTS idx_history_executed_at;
            DROP TABLE IF EXISTS history;
            PRAGMA secure_delete = OFF;
        `);
    }
};
