import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { FsCollectionStore } from './fs-collection-store';
import { resolveInside, toSegments } from './safe-path';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'otto-store-'));
const trashed: string[] = [];
const store = new FsCollectionStore({
    trash: async (absolute) => {
        trashed.push(absolute);
        fs.rmSync(absolute, { recursive: true });
    }
});

after(() => fs.rmSync(base, { recursive: true, force: true }));

describe('toSegments', () => {
    it('normaliza caminhos relativos', () => {
        assert.deepEqual(toSegments('a/./b//c.yaml'), ['a', 'b', 'c.yaml']);
        assert.deepEqual(toSegments(''), []);
    });

    it('rejeita caminhos perigosos', () => {
        for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:/x', 'a\\b', '.git/config', 'a/.env', 'a\0b']) {
            assert.throws(() => toSegments(bad), /Unsafe path/, bad);
        }
    });
});

describe('resolveInside', () => {
    it('bloqueia symlinks que apontam para fora da coleção', async () => {
        const root = fs.mkdtempSync(path.join(base, 'root-'));
        const outside = fs.mkdtempSync(path.join(base, 'outside-'));

        fs.symlinkSync(outside, path.join(root, 'escape'));

        await assert.rejects(resolveInside(root, 'escape/secret.yaml'), /outside the collection/);
        assert.equal((await resolveInside(root, 'new/dir/file.yaml')).absolute, path.join(root, 'new', 'dir', 'file.yaml'));
    });
});

describe('FsCollectionStore', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(base, 'col-'));
    });

    it('escreve de forma atômica, lê e lista ignorando ocultos, symlinks e node_modules', async () => {
        await store.writeFile(root, 'users/list.yaml', 'a');
        fs.mkdirSync(path.join(root, '.git'));
        fs.mkdirSync(path.join(root, 'node_modules'));
        fs.symlinkSync(root, path.join(root, 'loop'));

        assert.equal(await store.readFile(root, 'users/list.yaml'), 'a');
        assert.deepEqual(await store.list(root), [{ kind: 'directory', name: 'users', path: 'users', children: [{ kind: 'file', name: 'list.yaml', path: 'users/list.yaml', children: [] }] }]);
        assert.deepEqual(
            fs.readdirSync(path.join(root, 'users')).filter((f) => f.endsWith('.tmp')),
            []
        );
    });

    it('respeita createOnly e não permite escrever na raiz', async () => {
        await store.writeFile(root, 'a.yaml', '1', { createOnly: true });
        await assert.rejects(store.writeFile(root, 'a.yaml', '2', { createOnly: true }), /already exists/);
        await assert.rejects(store.writeFile(root, '', 'x'), /collection root/);
        assert.equal(await store.readFile(root, 'a.yaml'), '1');
    });

    it('move sem sobrescrever e impede mover pasta para dentro de si', async () => {
        await store.writeFile(root, 'a.yaml', 'a');
        await store.writeFile(root, 'b.yaml', 'b');
        await store.createDirectory(root, 'dir');

        await assert.rejects(store.move(root, 'a.yaml', 'b.yaml'), /already exists/);
        await assert.rejects(store.move(root, 'dir', 'dir/sub'), /into itself/);
        await store.move(root, 'a.yaml', 'dir/a.yaml');

        assert.equal(await store.exists(root, 'a.yaml'), false);
        assert.equal(await store.readFile(root, 'dir/a.yaml'), 'a');
    });

    it('remove pela lixeira e nunca a raiz', async () => {
        await store.writeFile(root, 'dir/a.yaml', 'a');
        await store.remove(root, 'dir');

        assert.deepEqual(trashed.at(-1), path.join(root, 'dir'));
        await assert.rejects(store.remove(root, ''), /collection root/);
        await assert.rejects(store.remove(root, 'missing.yaml'), /does not exist/);
    });

    it('cria a raiz apenas em pasta inexistente ou vazia', async () => {
        const fresh = path.join(base, 'fresh-collection');

        await store.createRoot(fresh);
        assert.equal(await store.isDirectory(fresh), true);

        fs.writeFileSync(path.join(fresh, 'x'), '');
        await assert.rejects(store.createRoot(fresh), /not empty/);
        await assert.rejects(store.createRoot('relative/dir'), /absolute/);
    });
});
