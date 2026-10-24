import type { DatabaseSync } from 'node:sqlite';

/** Migração de schema versionada. `up` roda dentro de uma transação. */
export interface Migration {
    readonly version: number;
    readonly name: string;
    up(db: DatabaseSync): void;
}

export interface AppliedMigration {
    version: number;
    name: string;
    appliedAt: string;
}

export interface IMigrationRunner {
    /** Aplica as migrações pendentes em ordem e retorna as que foram aplicadas agora. */
    migrate(): AppliedMigration[];
    applied(): AppliedMigration[];
}
