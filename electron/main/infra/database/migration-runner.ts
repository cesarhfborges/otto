import type { DatabaseSync } from 'node:sqlite';
import type { AppliedMigration, IClock, IMigrationRunner, Migration } from '../../core/contracts';
import { transaction } from './sqlite';

interface MigrationRow {
    version: number;
    name: string;
    applied_at: string;
}

/** Aplica migrações versionadas registrando-as em `schema_migrations`. */
export class MigrationRunner implements IMigrationRunner {
    private readonly migrations: readonly Migration[];

    constructor(
        private readonly db: DatabaseSync,
        migrations: readonly Migration[],
        private readonly clock: IClock
    ) {
        this.migrations = [...migrations].sort((a, b) => a.version - b.version);

        const versions = new Set<number>();

        for (const migration of this.migrations) {
            if (!Number.isInteger(migration.version) || migration.version <= 0 || versions.has(migration.version)) {
                throw new Error(`Invalid or duplicated migration version: ${migration.version}`);
            }

            versions.add(migration.version);
        }
    }

    applied(): AppliedMigration[] {
        this.ensureTable();

        const rows = this.db.prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version').all() as unknown as MigrationRow[];

        return rows.map((row) => ({ version: row.version, name: row.name, appliedAt: row.applied_at }));
    }

    migrate(): AppliedMigration[] {
        const done = new Set(this.applied().map((m) => m.version));
        const latestKnown = this.migrations.at(-1)?.version ?? 0;
        const latestApplied = Math.max(0, ...done);

        if (latestApplied > latestKnown) {
            // Banco criado por uma versão mais nova do Otto: não arriscamos corromper os dados.
            throw new Error(`Database schema version ${latestApplied} is newer than this app supports (${latestKnown}). Please update Otto.`);
        }

        const insert = this.db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
        const appliedNow: AppliedMigration[] = [];

        for (const migration of this.migrations) {
            if (done.has(migration.version)) {
                continue;
            }

            const appliedAt = this.clock.now();

            transaction(this.db, () => {
                migration.up(this.db);
                insert.run(migration.version, migration.name, appliedAt);
            });
            appliedNow.push({ version: migration.version, name: migration.name, appliedAt });
        }

        return appliedNow;
    }

    private ensureTable(): void {
        this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )`);
    }
}
