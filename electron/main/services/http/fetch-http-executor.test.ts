import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { DEFAULT_SETTINGS } from '../../../shared/models';
import { FetchHttpExecutor } from './fetch-http-executor';

describe('FetchHttpExecutor', () => {
    let server: Server;
    let baseUrl: string;

    before(async () => {
        server = createServer((req, res) => {
            if (req.url === '/redirect') {
                res.writeHead(302, { location: '/echo' });
                res.end();

                return;
            }

            if (req.url === '/slow') {
                setTimeout(() => res.end('late'), 2_000);

                return;
            }

            let body = '';

            req.on('data', (chunk) => (body += chunk));
            req.on('end', () => {
                res.writeHead(201, { 'content-type': 'application/json', 'x-echo': req.headers['x-test'] ?? '' });
                res.end(JSON.stringify({ method: req.method, body }));
            });
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    after(() => {
        server.closeAllConnections();
        server.close();
    });

    it('executa a requisição e mede a resposta', async () => {
        const result = await new FetchHttpExecutor().execute({ id: '1', method: 'POST', url: `${baseUrl}/echo`, headers: { 'X-Test': 'otto' }, body: 'hi' });

        assert.ok(result.ok);
        assert.equal(result.response.status, 201);
        assert.deepEqual(JSON.parse(result.response.body), { method: 'POST', body: 'hi' });
        assert.ok(result.response.headers.some(([key, value]) => key === 'x-echo' && value === 'otto'));
        assert.equal(result.response.size, Buffer.byteLength(result.response.body));
    });

    it('respeita o timeout', async () => {
        const result = await new FetchHttpExecutor().execute({ id: '2', method: 'GET', url: `${baseUrl}/slow`, timeoutMs: 50 });

        assert.equal(result.ok, false);
        assert.match(!result.ok ? result.error : '', /timed out after 50 ms/);
    });

    it('cancela uma requisição em andamento', async () => {
        const executor = new FetchHttpExecutor();
        const pending = executor.execute({ id: '3', method: 'GET', url: `${baseUrl}/slow` });

        assert.equal(executor.cancel('3'), true);

        const result = await pending;

        assert.equal(result.ok, false);
        assert.match(!result.ok ? result.error : '', /cancelled/);
        assert.equal(executor.cancel('3'), false);
    });

    it('usa o timeout padrão das preferências e permite desativá-lo com 0', async () => {
        const fromSettings = await new FetchHttpExecutor(() => ({ ...DEFAULT_SETTINGS.http, timeoutMs: 50 })).execute({ id: '5', method: 'GET', url: `${baseUrl}/slow` });

        assert.match(!fromSettings.ok ? fromSettings.error : '', /timed out after 50 ms/);

        const executor = new FetchHttpExecutor(() => ({ ...DEFAULT_SETTINGS.http, timeoutMs: 0 }));
        const pending = executor.execute({ id: '6', method: 'GET', url: `${baseUrl}/slow` });

        await new Promise((resolve) => setTimeout(resolve, 100));
        executor.cancel('6');
        assert.match(((await pending) as { error: string }).error, /cancelled/);
    });

    it('segue ou não redirecionamentos conforme as preferências', async () => {
        const follow = await new FetchHttpExecutor().execute({ id: '7', method: 'GET', url: `${baseUrl}/redirect` });
        const manual = await new FetchHttpExecutor(() => ({ ...DEFAULT_SETTINGS.http, followRedirects: false })).execute({ id: '8', method: 'GET', url: `${baseUrl}/redirect` });

        assert.equal(follow.ok && follow.response.status, 201);
        assert.equal(manual.ok && manual.response.status, 302);
    });

    it('rejeita protocolos não HTTP', async () => {
        const result = await new FetchHttpExecutor().execute({ id: '4', method: 'GET', url: 'file:///etc/passwd' });

        assert.equal(result.ok, false);
        assert.match(!result.ok ? result.error : '', /Unsupported protocol/);
    });
});
