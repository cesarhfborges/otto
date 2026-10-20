import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HttpRequest, HttpResult } from '../../../shared/models';
import type { IHttpExecutor } from '../../core/contracts';
import { SqliteCollectionMetadataRepository } from '../../infra/repositories/sqlite-collection-metadata.repository';
import { SqliteHistoryRepository } from '../../infra/repositories/sqlite-history.repository';
import { fakeClock, migratedMemoryDb, sequentialIds } from '../../testing/fixtures';
import { HistoryRecordingExecutor } from './history-recording-executor';

class StubExecutor implements IHttpExecutor {
    cancelled: string[] = [];

    constructor(private readonly result: HttpResult) {}

    async execute(_request: HttpRequest): Promise<HttpResult> {
        return this.result;
    }

    cancel(requestId: string): boolean {
        this.cancelled.push(requestId);

        return true;
    }
}

const okResult: HttpResult = {
    ok: true,
    timeline: [],
    response: {
        url: 'https://api.test/users',
        redirected: false,
        status: 200,
        statusText: 'OK',
        headers: [],
        contentType: 'application/json',
        body: '[]',
        bodyEncoding: 'utf8',
        size: 2,
        headersSize: 20,
        truncated: false,
        timeMs: 42,
        timings: { ttfbMs: 40, downloadMs: 2, totalMs: 42 }
    }
};

function setup(result: HttpResult = okResult, maxEntries = 100) {
    const db = migratedMemoryDb();
    const history = new SqliteHistoryRepository(db, fakeClock(), sequentialIds('h'));
    const collections = new SqliteCollectionMetadataRepository(db, fakeClock(), sequentialIds('c'));
    const inner = new StubExecutor(result);
    let notified = 0;
    const executor = new HistoryRecordingExecutor(inner, history, { maxEntries: () => maxEntries, onRecorded: () => notified++ });

    return { history, collections, inner, executor, notified: () => notified };
}

describe('HistoryRecordingExecutor', () => {
    it('registra a execução com a origem e avisa o renderer', async () => {
        const { history, collections, executor, notified } = setup();
        const collection = collections.create({ name: 'API', path: '/tmp/api', source: null, lastOpenedAt: null });
        const result = await executor.execute({ id: 'r1', method: 'GET', url: 'https://api.test/users', source: { collectionId: collection.id, requestPath: 'users/list.yaml' } });

        assert.equal(result, okResult);
        assert.deepEqual(
            history.list().map(({ collectionId, requestPath, method, url, status, error, timeMs, sizeBytes }) => ({ collectionId, requestPath, method, url, status, error, timeMs, sizeBytes })),
            [{ collectionId: collection.id, requestPath: 'users/list.yaml', method: 'GET', url: 'https://api.test/users', status: 200, error: null, timeMs: 42, sizeBytes: 2 }]
        );
        assert.equal(notified(), 1);
    });

    it('registra falhas sem status e remove credenciais da URL', async () => {
        const { history, executor } = setup({ ok: false, error: 'fetch failed: ECONNREFUSED', timeMs: 3, timeline: [] });

        await executor.execute({ id: 'r2', method: 'POST', url: 'https://user:secret@api.test/login' });

        const [entry] = history.list();

        assert.equal(entry!.status, null);
        assert.equal(entry!.error, 'fetch failed: ECONNREFUSED');
        assert.equal(entry!.url, 'https://api.test/login');
        assert.equal(entry!.sizeBytes, 0);
    });

    it('grava sem vínculo quando a coleção de origem não existe mais', async () => {
        const { history, executor } = setup();

        await executor.execute({ id: 'r3', method: 'GET', url: 'https://api.test', source: { collectionId: 'removed', requestPath: 'a.yaml' } });

        assert.equal(history.list()[0]!.collectionId, null);
    });

    it('aplica a retenção e não grava quando ela é 0', async () => {
        const kept = setup(okResult, 2);

        for (const id of ['a', 'b', 'c']) {
            await kept.executor.execute({ id, method: 'GET', url: `https://api.test/${id}` });
        }

        assert.deepEqual(
            kept.history.list().map((e) => e.url),
            ['https://api.test/c', 'https://api.test/b']
        );

        const disabled = setup(okResult, 0);

        await disabled.executor.execute({ id: 'x', method: 'GET', url: 'https://api.test' });
        assert.deepEqual(disabled.history.list(), []);
        assert.equal(disabled.notified(), 0);
    });

    it('repassa o cancelamento ao executor decorado', () => {
        const { inner, executor } = setup();

        assert.equal(executor.cancel('r9'), true);
        assert.deepEqual(inner.cancelled, ['r9']);
    });
});
