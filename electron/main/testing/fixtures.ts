import type { DatabaseSync } from 'node:sqlite';
import type { IClock, IIdGenerator } from '../core/contracts';
import { MigrationRunner } from '../infra/database/migration-runner';
import { MIGRATIONS } from '../infra/database/migrations';
import { openDatabase } from '../infra/database/sqlite';

/** Relógio que avança 1 s a cada leitura, a partir de uma data fixa. */
export function fakeClock(start = '2026-01-01T00:00:00.000Z'): IClock {
    let current = Date.parse(start);

    return {
        now: () => {
            const value = new Date(current).toISOString();

            current += 1_000;

            return value;
        }
    };
}

export function sequentialIds(prefix = 'id'): IIdGenerator {
    let n = 0;

    return { next: () => `${prefix}-${++n}` };
}

/** Banco em memória com todas as migrações aplicadas. */
export function migratedMemoryDb(): DatabaseSync {
    const db = openDatabase(':memory:');

    new MigrationRunner(db, MIGRATIONS, fakeClock()).migrate();

    return db;
}
