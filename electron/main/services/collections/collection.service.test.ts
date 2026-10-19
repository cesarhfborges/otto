import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { emptyRequest } from '../../../shared/models';
import type { ICollectionWatcher } from '../../core/contracts';
import { FsCollectionStore } from '../../infra/collections/fs-collection-store';
import { YamlCollectionFormat } from '../../infra/collections/yaml-collection-format';
import { SqliteCollectionMetadataRepository } from '../../infra/repositories/sqlite-collection-metadata.repository';
import { fakeClock, migratedMemoryDb, sequentialIds } from '../../testing/fixtures';
import { CollectionService } from './collection.service';
import { slugify } from './slug';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'otto-service-'));

after(() => fs.rmSync(base, { recursive: true, force: true }));

const setup = () => {
    const watched: Array<{ root: string; trigger: () => void; closed: boolean }> = [];
    const watcher: ICollectionWatcher = {
        watch: (root, onChange) => {
            const entry = { root, trigger: onChange, closed: false };

            watched.push(entry);

            return () => {
                entry.closed = true;
            };
        }
    };
    const metadata = new SqliteCollectionMetadataRepository(migratedMemoryDb(), fakeClock(), sequentialIds('col'));
    const store = new FsCollectionStore({ trash: async (p) => fs.rmSync(p, { recursive: true }) });
    const service = new CollectionService(store, new YamlCollectionFormat(), metadata, watcher, fakeClock('2026-05-01T00:00:00.000Z'));
    const parent = fs.mkdtempSync(path.join(base, 'parent-'));

    return { service, metadata, watched, parent };
};

describe('CollectionService', () => {
    it('cria a coleção no disco, registra no banco e observa a pasta', async () => {
        const { service, metadata, watched, parent } = setup();
        const opened = await service.create(parent, 'Pet Store API');
        const root = path.join(parent, 'pet-store-api');

        assert.equal(opened.metadata.path, root);
        assert.equal(opened.manifest.name, 'Pet Store API');
        assert.equal(fs.readFileSync(path.join(root, 'otto.yaml'), 'utf-8'), 'version: 1\nname: Pet Store API\n');
        assert.equal(metadata.findByPath(root)?.lastOpenedAt, '2026-05-01T00:00:00.000Z');
        service.close(opened.metadata.id);
        assert.deepEqual(
            watched.map((w) => w.root),
            [root]
        );

        await assert.rejects(service.create(parent, 'Pet Store API'), /already exists/);
    });

    it('reabrir atualiza o registro existente em vez de duplicar', async () => {
        const { service, metadata, parent } = setup();
        const first = await service.create(parent, 'API');

        fs.writeFileSync(path.join(first.metadata.path, 'otto.yaml'), 'version: 1\nname: Renamed API\n');

        const again = await service.open(first.metadata.path);

        assert.equal(again.metadata.id, first.metadata.id);
        assert.equal(again.metadata.name, 'Renamed API');
        assert.equal(metadata.findAll().length, 1);
    });

    it('recusa pastas que não são coleções', async () => {
        const { service, parent } = setup();

        await assert.rejects(service.open(parent), /not an Otto collection/);
        await assert.rejects(service.open(path.join(parent, 'missing')), /does not exist/);
    });

    it('cria requisições com nomes únicos e monta a árvore ordenada', async () => {
        const { service, parent } = setup();
        const { metadata } = await service.create(parent, 'API');
        const id = metadata.id;

        await service.createFolder(id, '', 'users');
        assert.equal(await service.createRequest(id, 'users', { ...emptyRequest('List users'), seq: 2 }), 'users/list-users.yaml');
        assert.equal(await service.createRequest(id, 'users', { ...emptyRequest('List users'), seq: 1, method: 'POST' }), 'users/list-users-2.yaml');
        assert.equal(await service.createRequest(id, '', emptyRequest('Health check')), 'health-check.yaml');
        fs.writeFileSync(path.join(metadata.path, 'broken.yaml'), 'name: [oops');
        fs.writeFileSync(path.join(metadata.path, 'README.md'), '# not a request');

        const tree = await service.tree(id);

        assert.deepEqual(
            tree.children.map((n) => [n.type, n.name]),
            [
                ['folder', 'users'],
                ['request', 'broken.yaml'],
                ['request', 'Health check']
            ]
        );

        const users = tree.children[0]!;

        assert.ok(users.type === 'folder');
        assert.deepEqual(
            users.children.map((n) => n.type === 'request' && [n.path, n.method, n.seq]),
            [
                ['users/list-users-2.yaml', 'POST', 1],
                ['users/list-users.yaml', 'GET', 2]
            ]
        );

        const broken = tree.children[1]!;

        assert.ok(broken.type === 'request' && broken.method === null && /Invalid YAML/.test(broken.error ?? ''));
    });

    it('lê, salva, move e remove requisições respeitando as regras do formato', async () => {
        const { service, parent } = setup();
        const { metadata } = await service.create(parent, 'API');
        const id = metadata.id;
        const requestPath = await service.createRequest(id, '', emptyRequest('Get item'));

        await service.saveRequest(id, requestPath, { ...emptyRequest('Get item'), url: 'http://x/items/1' });
        assert.equal((await service.readRequest(id, requestPath)).url, 'http://x/items/1');

        await assert.rejects(service.saveRequest(id, 'notes.md', emptyRequest('x')), /not a request file/);
        await assert.rejects(service.move(id, requestPath, 'item.txt'), /not a valid request file name/);
        await assert.rejects(service.move(id, 'otto.yaml', 'x.yaml'), /cannot be changed/);
        await assert.rejects(service.remove(id, 'otto.yaml'), /cannot be changed/);
        await assert.rejects(service.readRequest(id, '../outside.yaml'), /Unsafe path/);

        await service.move(id, requestPath, 'items/get-item.yaml');
        assert.equal((await service.readRequest(id, 'items/get-item.yaml')).name, 'Get item');

        await service.remove(id, 'items');
        assert.deepEqual((await service.tree(id)).children, []);
    });

    it('emite mudanças das operações e do watcher e para de observar ao fechar', async () => {
        const { service, watched, parent } = setup();
        const { metadata } = await service.create(parent, 'API');
        const events: string[] = [];

        service.onChanged((collectionId) => events.push(collectionId));
        await service.createFolder(metadata.id, '', 'docs');
        watched[0]!.trigger();
        service.close(metadata.id);

        assert.deepEqual(events, [metadata.id, metadata.id]);
        assert.equal(watched[0]!.closed, true);
        assert.equal((await service.tree(metadata.id)).children.length, 1);
        await assert.rejects(service.tree('missing'), /not found/);
    });
});

describe('slugify', () => {
    it('gera nomes de arquivo seguros', () => {
        assert.equal(slugify('Créer usuário #1'), 'creer-usuario-1');
        assert.equal(slugify('  GET /users/{id}  '), 'get-users-id');
        assert.equal(slugify('!!!'), 'untitled');
        assert.equal(slugify('CON'), 'con-1');
        assert.equal(slugify('a'.repeat(200)).length, 80);
    });
});
