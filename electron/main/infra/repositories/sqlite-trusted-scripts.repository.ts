import type { DatabaseSync } from 'node:sqlite';
import type { CollectionScript, EntityId } from '../../../shared/models';
import type { ITrustedScriptsRepository } from '../../core/contracts';
import { transaction } from '../database/sqlite';

/** Snapshot dos scripts confiados de cada coleção (apagado junto com a coleção). */
export class SqliteTrustedScriptsRepository implements ITrustedScriptsRepository {
    constructor(private readonly db: DatabaseSync) {}

    list(collectionId: EntityId): CollectionScript[] {
        return this.db.prepare('SELECT location, path, phase, code FROM trusted_scripts WHERE collection_id = ? ORDER BY location, path, phase').all(collectionId) as unknown as CollectionScript[];
    }

    replace(collectionId: EntityId, scripts: readonly CollectionScript[]): void {
        transaction(this.db, () => {
            this.db.prepare('DELETE FROM trusted_scripts WHERE collection_id = ?').run(collectionId);

            const insert = this.db.prepare('INSERT INTO trusted_scripts (collection_id, location, path, phase, code) VALUES (?, ?, ?, ?, ?)');

            for (const script of scripts) {
                insert.run(collectionId, script.location, script.path, script.phase, script.code);
            }
        });
    }
}
