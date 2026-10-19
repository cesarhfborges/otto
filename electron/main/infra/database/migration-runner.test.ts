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
            [1, 2, 3]
        );
        assert.deepEqual(tables(db), ['collections_metadata', 'environments', 'history', 'schema_migrations', 'settings', 'tabs', 'workspace_collections', 'workspaces']);
        assert.deepEqual(runner.migrate(), []);
        assert.equal(runner.applied().length, 3);
    });

    it('003 leva coleções abertas, abas e ambientes globais para o workspace padrão', () => {
        const db = openDatabase(':memory:');

        new MigrationRunner(db, MIGRATIONS.slice(0, 2), fakeClock()).migrate();
        db.exec(`
            INSERT INTO collections_metadata (id, name, path, created_at, updated_at, is_open) VALUES ('c1', 'A', '/a', 'x', 'x', 1), ('c2', 'B', '/b', 'x', 'x', 0);
            INSERT INTO tabs (id, kind, title, position, collection_id) VALUES ('t1', 'request', 'Login', 0, 'c1');
            INSERT INTO environments (id, collection_id, name, created_at, updated_at) VALUES ('g', NULL, 'Global', 'x', 'x'), ('e', 'c1', 'dev', 'x', 'x');
        `);
        new MigrationRunner(db, MIGRATIONS, fakeClock()).migrate();

        assert.deepEqual(
            db
                .prepare('SELECT id, name, path FROM workspaces')
                .all()
                .map((row) => ({ ...row })),
            [{ id: 'default', name: 'My Workspace', path: null }]
        );
        assert.deepEqual(
            db
                .prepare('SELECT workspace_id, collection_id FROM workspace_collections')
                .all()
                .map((row) => ({ ...row })),
            [{ workspace_id: 'default', collection_id: 'c1' }]
        );
        assert.equal((db.prepare('SELECT workspace_id FROM tabs').get() as { workspace_id: string }).workspace_id, 'default');
        assert.deepEqual(
            db
                .prepare('SELECT id, workspace_id FROM environments ORDER BY id')
                .all()
                .map((row) => ({ ...row })),
            [
                { id: 'e', workspace_id: null },
                { id: 'g', workspace_id: 'default' }
            ]
        );
        assert.ok(
            !db
                .prepare('PRAGMA table_info(collections_metadata)')
                .all()
                .some((column) => (column as { name: string }).name === 'is_open')
        );
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
