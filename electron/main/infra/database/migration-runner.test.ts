import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Migration } from '../../core/contracts';
import { fakeClock } from '../../testing/fixtures';
import { MigrationRunner } from './migration-runner';
import { MIGRATIONS } from './migrations';
import { openDatabase } from './sqlite';

const tables = (db: ReturnType<typeof openDatabase>): string[] => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);

describe('MigrationRunner', () => {
    it('cria o schema inicial e é idempotente', () => {
        const db = openDatabase(':memory:');
        const runner = new MigrationRunner(db, MIGRATIONS, fakeClock());

        assert.deepEqual(
            runner.migrate().map((m) => m.version),
            [1, 2]
        );
        assert.deepEqual(tables(db), ['collections_metadata', 'environments', 'history', 'schema_migrations', 'settings', 'tabs']);
        assert.deepEqual(runner.migrate(), []);
        assert.equal(runner.applied().length, 2);
    });

    it('aplica em ordem e faz rollback de migração com erro', () => {
        const db = openDatabase(':memory:');
        const migrations: Migration[] = [
            { version: 2, name: 'broken', up: (d) => d.exec('CREATE TABLE b (x); SELECT * FROM missing_table') },
            { version: 1, name: 'a', up: (d) => d.exec('CREATE TABLE a (x)') }
        ];

        assert.throws(() => new MigrationRunner(db, migrations, fakeClock()).migrate(), /missing_table/);
        assert.deepEqual(tables(db), ['a', 'schema_migrations']);
        assert.deepEqual(
            new MigrationRunner(db, migrations, fakeClock()).applied().map((m) => m.name),
            ['a']
        );
    });

    it('recusa versões duplicadas ou inválidas', () => {
        const db = openDatabase(':memory:');
        const noop = () => undefined;

        assert.throws(
            () =>
                new MigrationRunner(
                    db,
                    [
                        { version: 1, name: 'a', up: noop },
                        { version: 1, name: 'b', up: noop }
                    ],
                    fakeClock()
                ),
            /duplicated/
        );
        assert.throws(() => new MigrationRunner(db, [{ version: 0, name: 'a', up: noop }], fakeClock()), /Invalid/);
    });

    it('recusa banco criado por uma versão mais nova do app', () => {
        const db = openDatabase(':memory:');

        new MigrationRunner(db, [...MIGRATIONS, { version: 99, name: 'future', up: () => undefined }], fakeClock()).migrate();

        assert.throws(() => new MigrationRunner(db, MIGRATIONS, fakeClock()).migrate(), /newer than this app supports/);
    });
});
