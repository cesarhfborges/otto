import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_SETTINGS, type NewHistoryEntry, type TabState } from '../../../shared/models';
import { fakeClock, migratedMemoryDb, sequentialIds } from '../../testing/fixtures';
import { SqliteCollectionMetadataRepository } from './sqlite-collection-metadata.repository';
import { SqliteEnvironmentRepository } from './sqlite-environment.repository';
import { SqliteHistoryRepository } from './sqlite-history.repository';
import { SqliteSettingsStore } from './sqlite-settings.store';
import { SqliteTabRepository } from './sqlite-tab.repository';

const setup = () => {
    const db = migratedMemoryDb();
    const clock = fakeClock();
    const ids = sequentialIds();

    return {
        db,
        settings: new SqliteSettingsStore(db, clock),
        history: new SqliteHistoryRepository(db, clock, ids),
        tabs: new SqliteTabRepository(db),
        environments: new SqliteEnvironmentRepository(db, clock, ids),
        collections: new SqliteCollectionMetadataRepository(db, clock, ids)
    };
};

const historyEntry = (overrides: Partial<NewHistoryEntry> = {}): NewHistoryEntry => ({
    collectionId: null,
    requestPath: null,
    method: 'GET',
    url: 'https://example.com',
    status: 200,
    error: null,
    timeMs: 12,
    sizeBytes: 34,
    ...overrides
});

describe('SqliteSettingsStore', () => {
    it('retorna padrões, persiste alterações aninhadas e ignora valores inválidos no banco', () => {
        const { db, settings } = setup();

        assert.deepEqual(settings.get(), DEFAULT_SETTINGS);

        const updated = settings.update({ minimizeToTray: false, theme: 'dark', http: { proxy: { enabled: true, url: 'http://proxy:3128' } } });

        assert.equal(updated.minimizeToTray, false);
        assert.equal(updated.theme, 'dark');
        assert.deepEqual(updated.http.proxy, { enabled: true, url: 'http://proxy:3128', bypass: DEFAULT_SETTINGS.http.proxy.bypass });
        assert.equal(updated.http.timeoutMs, DEFAULT_SETTINGS.http.timeoutMs);

        db.prepare("UPDATE settings SET value = '\"yes\"' WHERE key = 'minimizeToTray'").run();
        db.prepare("UPDATE settings SET value = '\"neon\"' WHERE key = 'theme'").run();
        assert.equal(settings.get().minimizeToTray, true);
        assert.equal(settings.get().theme, 'auto');
        assert.equal(settings.get().http.proxy.enabled, true);
    });

    it('grava uma linha por preferência alterada', () => {
        const { db, settings } = setup();

        settings.update({ http: { ssl: { verifyCertificates: false } } });

        assert.deepEqual(
            db
                .prepare('SELECT key, value FROM settings')
                .all()
                .map((r) => ({ ...r })),
            [{ key: 'http.ssl.verifyCertificates', value: 'false' }]
        );
    });

    it('guarda o estado da janela separado das preferências', () => {
        const { settings } = setup();

        assert.equal(settings.getBounds(), undefined);
        settings.setBounds({ x: 10, y: 20, width: 800, height: 600 });
        assert.deepEqual(settings.getBounds(), { x: 10, y: 20, width: 800, height: 600 });
        assert.deepEqual(settings.get(), DEFAULT_SETTINGS);
    });
});

describe('SqliteHistoryRepository', () => {
    it('adiciona, lista do mais recente para o mais antigo e pagina', () => {
        const { history } = setup();

        history.add(historyEntry({ url: 'https://a' }));
        history.add(historyEntry({ url: 'https://b', status: null, error: 'ECONNREFUSED' }));
        history.add(historyEntry({ url: 'https://c' }));

        assert.deepEqual(
            history.list().map((e) => e.url),
            ['https://c', 'https://b', 'https://a']
        );
        assert.deepEqual(
            history.list({ limit: 1, offset: 1 }).map((e) => e.url),
            ['https://b']
        );
        assert.equal(history.list({ limit: 1, offset: 1 })[0]!.error, 'ECONNREFUSED');
    });

    it('filtra por coleção, remove e limpa', () => {
        const { history, collections } = setup();
        const collection = collections.create({ name: 'API', path: '/tmp/api', source: null, lastOpenedAt: null });
        const entry = history.add(historyEntry({ collectionId: collection.id }));

        history.add(historyEntry());

        assert.deepEqual(
            history.list({ collectionId: collection.id }).map((e) => e.id),
            [entry.id]
        );
        assert.equal(history.delete(entry.id), true);
        assert.equal(history.delete(entry.id), false);
        assert.equal(history.clear(), 1);
        assert.deepEqual(history.list(), []);
    });

    it('apaga os registros mais antigos além da retenção', () => {
        const { history } = setup();

        for (const url of ['https://1', 'https://2', 'https://3', 'https://4']) {
            history.add(historyEntry({ url }));
        }

        assert.equal(history.prune(2), 2);
        assert.deepEqual(
            history.list().map((e) => e.url),
            ['https://4', 'https://3']
        );
        assert.equal(history.prune(2), 0);
        assert.equal(history.prune(0), 2);
    });

    it('mantém o histórico ao remover a coleção (ON DELETE SET NULL)', () => {
        const { history, collections } = setup();
        const collection = collections.create({ name: 'API', path: '/tmp/api', source: null, lastOpenedAt: null });

        history.add(historyEntry({ collectionId: collection.id }));
        collections.delete(collection.id);

        assert.equal(history.list()[0]!.collectionId, null);
    });
});

describe('SqliteTabRepository', () => {
    it('substitui o conjunto de abas e lista por posição', () => {
        const { tabs } = setup();
        const tab = (id: string, position: number, active = false): TabState => ({ id, kind: 'request', title: id, collectionId: null, resourceRef: `${id}.yaml`, position, active, draft: null });

        tabs.replaceAll('default', [tab('b', 1, true), tab('a', 0)]);
        assert.deepEqual(
            tabs.list('default').map((t) => [t.id, t.active]),
            [
                ['a', false],
                ['b', true]
            ]
        );

        tabs.replaceAll('default', [tab('c', 0)]);
        assert.deepEqual(
            tabs.list('default').map((t) => t.id),
            ['c']
        );
    });

    it('vincula abas a coleções e as remove junto com a coleção', () => {
        const { tabs, collections } = setup();
        const collection = collections.create({ name: 'API', path: '/tmp/api', source: null, lastOpenedAt: null });

        tabs.replaceAll('default', [
            { id: 'w', kind: 'overview', title: 'Overview', collectionId: null, resourceRef: null, position: 0, active: false, draft: null },
            { id: 'r', kind: 'request', title: 'Login', collectionId: collection.id, resourceRef: 'auth/login.yaml', position: 1, active: true, draft: null }
        ]);
        assert.equal(tabs.list('default')[1]!.collectionId, collection.id);

        collections.delete(collection.id);
        assert.deepEqual(
            tabs.list('default').map((t) => t.id),
            ['w']
        );
    });

    it('não altera nada se a gravação falhar no meio', () => {
        const { tabs } = setup();
        const tab: TabState = { id: 'a', kind: 'request', title: 'a', collectionId: null, resourceRef: null, position: 0, active: false, draft: null };

        tabs.replaceAll('default', [tab]);
        assert.throws(() => tabs.replaceAll('default', [tab, { ...tab }]), /UNIQUE/);
        assert.deepEqual(
            tabs.list('default').map((t) => t.id),
            ['a']
        );
    });
});

describe('SqliteEnvironmentRepository', () => {
    it('faz CRUD e separa ambientes globais dos de coleção', () => {
        const { environments, collections } = setup();
        const collection = collections.create({ name: 'API', path: '/tmp/api', source: null, lastOpenedAt: null });
        const global = environments.create({ collectionId: null, name: 'Global', variables: [] });
        const dev = environments.create({ collectionId: collection.id, name: 'dev', variables: [{ key: 'baseUrl', value: 'http://localhost', enabled: true, secret: false }] });

        assert.deepEqual(
            environments.findByCollection(null).map((e) => e.id),
            [global.id]
        );
        assert.deepEqual(environments.findByCollection(collection.id)[0]!.variables, dev.variables);

        const updated = environments.update(dev.id, { name: 'development' });

        assert.equal(updated?.name, 'development');
        assert.deepEqual(updated?.variables, dev.variables);
        assert.notEqual(updated?.updatedAt, dev.updatedAt);
        assert.equal(environments.update('missing', { name: 'x' }), null);
        assert.equal(environments.findAll().length, 2);
        assert.equal(environments.delete(global.id), true);
        assert.equal(environments.findById(global.id), null);
    });

    it('remove os ambientes junto com a coleção (ON DELETE CASCADE)', () => {
        const { environments, collections } = setup();
        const collection = collections.create({ name: 'API', path: '/tmp/api', source: null, lastOpenedAt: null });

        environments.create({ collectionId: collection.id, name: 'dev', variables: [] });
        collections.delete(collection.id);

        assert.deepEqual(environments.findAll(), []);
    });
});

describe('SqliteCollectionMetadataRepository', () => {
    it('faz CRUD, serializa a origem e busca por caminho', () => {
        const { collections } = setup();
        const source = { kind: 'openapi' as const, location: 'https://example.com/openapi.json', lastHash: null, lastCheckedAt: null };
        const created = collections.create({ name: 'Petstore', path: '/tmp/petstore', source, lastOpenedAt: null });

        assert.deepEqual(collections.findById(created.id)?.source, source);
        assert.equal(collections.findByPath('/tmp/petstore')?.id, created.id);
        assert.equal(collections.update(created.id, { name: 'Pets' })?.name, 'Pets');
        assert.equal(collections.delete(created.id), true);
        assert.equal(collections.findById(created.id), null);
    });

    it('impede duas coleções no mesmo caminho', () => {
        const { collections } = setup();
        const a = collections.create({ name: 'A', path: '/tmp/a', source: null, lastOpenedAt: null });

        collections.create({ name: 'B', path: '/tmp/b', source: null, lastOpenedAt: null });

        assert.throws(() => collections.create({ name: 'A2', path: '/tmp/a', source: null, lastOpenedAt: null }), /already registered/);
        assert.throws(() => collections.update(a.id, { path: '/tmp/b' }), /already registered/);
    });

    it('ordena pelas abertas mais recentemente', () => {
        const { collections } = setup();

        collections.create({ name: 'never', path: '/tmp/1', source: null, lastOpenedAt: null });
        collections.create({ name: 'old', path: '/tmp/2', source: null, lastOpenedAt: '2025-01-01T00:00:00.000Z' });
        collections.create({ name: 'recent', path: '/tmp/3', source: null, lastOpenedAt: '2026-01-01T00:00:00.000Z' });

        assert.deepEqual(
            collections.findAll().map((c) => c.name),
            ['recent', 'old', 'never']
        );
    });
});
