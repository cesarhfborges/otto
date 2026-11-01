import type { Migration } from '../../../core/contracts';

/**
 * Confiança nos scripts de cada coleção (`collections_metadata.scripts_trusted`).
 * As coleções já conhecidas continuam rodando scripts como antes (confiáveis); as que
 * o app passar a conhecer depois disso (importadas, vindas do Git) nascem não confiáveis.
 */
export const scriptsTrust: Migration = {
    version: 6,
    name: 'scripts-trust',
    up(db) {
        db.exec(`ALTER TABLE collections_metadata ADD COLUMN scripts_trusted INTEGER NOT NULL DEFAULT 1 CHECK (scripts_trusted IN (0, 1));`);
    }
};
