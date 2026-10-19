import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DEFAULT_SETTINGS, type HttpSettings } from '../../../shared/models';
import { TEST_TLS_CERT, TEST_TLS_KEY } from '../../testing/tls';
import { DispatcherProvider } from './dispatcher-provider';
import { FetchHttpExecutor } from './fetch-http-executor';

const listen = async (server: Server | HttpsServer): Promise<number> => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    return (server.address() as AddressInfo).port;
};

const stop = (server: Server | HttpsServer) => {
    server.closeAllConnections();
    server.close();
};

const http = (overrides: Partial<HttpSettings> = {}): (() => HttpSettings) => {
    const settings = { ...structuredClone(DEFAULT_SETTINGS.http), ...overrides };

    return () => settings;
};

/** Proxy HTTP mínimo: URI absoluta para `http:` e túnel `CONNECT` para `https:`. Registra o que passou por ele. */
function createProxy(seen: string[]): Server {
    const proxy = createServer((req: IncomingMessage, res) => {
        seen.push(`${req.method} ${req.url}`);

        const target = new URL(req.url!);
        const upstream = httpRequest({ host: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers: req.headers }, (answer) => {
            res.writeHead(answer.statusCode!, { ...answer.headers, 'x-via-proxy': 'yes' });
            answer.pipe(res);
        });

        req.pipe(upstream);
    });

    proxy.on('connect', (req: IncomingMessage, client: Socket, head: Buffer) => {
        seen.push(`CONNECT ${req.url}`);

        const [host, port] = req.url!.split(':');
        const upstream = connect(Number(port), host, () => {
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            upstream.write(head);
            upstream.pipe(client);
            client.pipe(upstream);
        });

        upstream.on('error', () => client.destroy());
        client.on('error', () => upstream.destroy());
    });

    return proxy;
}

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

            if (req.url === '/big') {
                res.writeHead(200, { 'content-type': 'text/plain' });
                res.end('x'.repeat(10_000));

                return;
            }

            if (req.url === '/image') {
                res.writeHead(200, { 'content-type': 'image/png' });
                res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]));

                return;
            }

            if (req.url === '/latin1') {
                res.writeHead(200, { 'content-type': 'text/plain; charset=iso-8859-1' });
                res.end(Buffer.from([0x63, 0x61, 0x66, 0xe9]));

                return;
            }

            let body = '';

            req.on('data', (chunk) => (body += chunk));
            req.on('end', () => {
                res.writeHead(201, { 'content-type': 'application/json', 'x-echo': req.headers['x-test'] ?? '', 'x-user-agent': req.headers['user-agent'] ?? '' });
                res.end(JSON.stringify({ method: req.method, body }));
            });
        });
        baseUrl = `http://127.0.0.1:${await listen(server)}`;
    });

    after(() => stop(server));

    it('executa a requisição e mede a resposta', async () => {
        const result = await new FetchHttpExecutor().execute({ id: '1', method: 'POST', url: `${baseUrl}/echo`, headers: { 'X-Test': 'otto' }, body: 'hi' });

        assert.ok(result.ok);

        const { response } = result;

        assert.equal(response.status, 201);
        assert.deepEqual(JSON.parse(response.body), { method: 'POST', body: 'hi' });
        assert.ok(response.headers.some(([key, value]) => key === 'x-echo' && value === 'otto'));
        assert.equal(response.contentType, 'application/json');
        assert.equal(response.bodyEncoding, 'utf8');
        assert.equal(response.size, Buffer.byteLength(response.body));
        assert.ok(response.headersSize > 50);
        assert.equal(response.truncated, false);
        assert.equal(response.timings.totalMs, response.timeMs);
        assert.equal(response.timings.ttfbMs + response.timings.downloadMs, response.timings.totalMs);
    });

    it('envia o User-Agent padrão sem sobrescrever o da requisição', async () => {
        const executor = new FetchHttpExecutor({ userAgent: 'Otto/1.0' });
        const header = (result: Awaited<ReturnType<FetchHttpExecutor['execute']>>) => (result.ok ? result.response.headers.find(([key]) => key === 'x-user-agent')?.[1] : undefined);

        assert.equal(header(await executor.execute({ id: 'ua1', method: 'GET', url: `${baseUrl}/echo` })), 'Otto/1.0');
        assert.equal(header(await executor.execute({ id: 'ua2', method: 'GET', url: `${baseUrl}/echo`, headers: { 'User-Agent': 'custom' } })), 'custom');
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
        const fromSettings = await new FetchHttpExecutor({ settings: http({ timeoutMs: 50 }) }).execute({ id: '5', method: 'GET', url: `${baseUrl}/slow` });

        assert.match(!fromSettings.ok ? fromSettings.error : '', /timed out after 50 ms/);

        const executor = new FetchHttpExecutor({ settings: http({ timeoutMs: 0 }) });
        const pending = executor.execute({ id: '6', method: 'GET', url: `${baseUrl}/slow` });

        await new Promise((resolve) => setTimeout(resolve, 100));
        executor.cancel('6');
        assert.match(((await pending) as { error: string }).error, /cancelled/);
    });

    it('segue ou não redirecionamentos conforme as preferências', async () => {
        const follow = await new FetchHttpExecutor().execute({ id: '7', method: 'GET', url: `${baseUrl}/redirect` });
        const manual = await new FetchHttpExecutor({ settings: http({ followRedirects: false }) }).execute({ id: '8', method: 'GET', url: `${baseUrl}/redirect` });

        assert.ok(follow.ok && manual.ok);
        assert.equal(follow.response.status, 201);
        assert.equal(follow.response.redirected, true);
        assert.equal(follow.response.url, `${baseUrl}/echo`);
        assert.equal(manual.response.status, 302);
        assert.equal(manual.response.redirected, false);
        assert.ok(manual.response.headers.some(([key, value]) => key === 'location' && value === '/echo'));
    });

    it('trunca respostas acima do limite', async () => {
        const result = await new FetchHttpExecutor({ maxResponseBytes: 1_000 }).execute({ id: '9', method: 'GET', url: `${baseUrl}/big` });

        assert.ok(result.ok);
        assert.equal(result.response.truncated, true);
        assert.equal(result.response.size, 1_000);
        assert.equal(result.response.body, 'x'.repeat(1_000));
    });

    it('devolve conteúdo binário em base64 e respeita o charset', async () => {
        const executor = new FetchHttpExecutor();
        const image = await executor.execute({ id: '10', method: 'GET', url: `${baseUrl}/image` });
        const latin1 = await executor.execute({ id: '11', method: 'GET', url: `${baseUrl}/latin1` });

        assert.ok(image.ok && latin1.ok);
        assert.equal(image.response.bodyEncoding, 'base64');
        assert.deepEqual([...Buffer.from(image.response.body, 'base64')], [0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
        assert.equal(image.response.size, 6);
        assert.equal(latin1.response.body, 'café');
    });

    it('rejeita protocolos não HTTP', async () => {
        const result = await new FetchHttpExecutor().execute({ id: '4', method: 'GET', url: 'file:///etc/passwd' });

        assert.equal(result.ok, false);
        assert.match(!result.ok ? result.error : '', /Unsupported protocol/);
    });

    describe('HTTPS', () => {
        let secure: HttpsServer;
        let secureUrl: string;
        let dir: string;

        before(async () => {
            secure = createHttpsServer({ cert: TEST_TLS_CERT, key: TEST_TLS_KEY }, (_req, res) => res.end('secure'));
            secureUrl = `https://localhost:${await listen(secure)}/`;
            dir = mkdtempSync(path.join(tmpdir(), 'otto-tls-'));
        });

        after(() => {
            stop(secure);
            rmSync(dir, { recursive: true, force: true });
        });

        it('recusa certificado autoassinado por padrão, com dica de como resolver', async () => {
            const result = await new FetchHttpExecutor().execute({ id: 's1', method: 'GET', url: secureUrl });

            assert.equal(result.ok, false);
            assert.match(!result.ok ? result.error : '', /SELF_SIGNED|DEPTH_ZERO/);
            assert.match(!result.ok ? result.error : '', /Preferences → Certificates/);
        });

        it('aceita o certificado quando a verificação está desligada', async () => {
            const result = await new FetchHttpExecutor({ settings: http({ ssl: { verifyCertificates: false, caCertificatePath: null } }) }).execute({ id: 's2', method: 'GET', url: secureUrl });

            assert.equal(result.ok && result.response.body, 'secure');
        });

        it('confia numa CA adicional configurada', async () => {
            const caPath = path.join(dir, 'ca.pem');

            writeFileSync(caPath, TEST_TLS_CERT);

            const result = await new FetchHttpExecutor({ settings: http({ ssl: { verifyCertificates: true, caCertificatePath: caPath } }) }).execute({ id: 's3', method: 'GET', url: secureUrl });

            assert.equal(result.ok && result.response.body, 'secure');
        });

        it('explica quando o arquivo de CA não existe ou não é PEM', async () => {
            const notPem = path.join(dir, 'not.pem');

            writeFileSync(notPem, 'hello');

            const missing = await new FetchHttpExecutor({ settings: http({ ssl: { verifyCertificates: true, caCertificatePath: path.join(dir, 'missing.pem') } }) }).execute({ id: 's4', method: 'GET', url: secureUrl });
            const invalid = await new FetchHttpExecutor({ settings: http({ ssl: { verifyCertificates: true, caCertificatePath: notPem } }) }).execute({ id: 's5', method: 'GET', url: secureUrl });

            assert.match(!missing.ok ? missing.error : '', /Could not read the CA certificate .*ENOENT/);
            assert.match(!invalid.ok ? invalid.error : '', /is not a PEM certificate/);
        });
    });

    describe('proxy', () => {
        const seen: string[] = [];
        let proxy: Server;
        let proxyUrl: string;
        let secure: HttpsServer;
        let securePort: number;

        before(async () => {
            proxy = createProxy(seen);
            proxyUrl = `http://127.0.0.1:${await listen(proxy)}`;
            secure = createHttpsServer({ cert: TEST_TLS_CERT, key: TEST_TLS_KEY }, (_req, res) => res.end('secure via tunnel'));
            securePort = await listen(secure);
        });

        after(() => {
            stop(proxy);
            stop(secure);
        });

        const proxied = (bypass = '') => http({ proxy: { enabled: true, url: proxyUrl, bypass }, ssl: { verifyCertificates: false, caCertificatePath: null } });

        it('envia requisições HTTP pelo proxy com URI absoluta', async () => {
            seen.length = 0;

            const result = await new FetchHttpExecutor({ settings: proxied() }).execute({ id: 'p1', method: 'GET', url: `${baseUrl}/echo` });

            assert.ok(result.ok);
            assert.ok(result.response.headers.some(([key]) => key === 'x-via-proxy'));
            assert.deepEqual(seen, [`GET ${baseUrl}/echo`]);
        });

        it('usa túnel CONNECT para HTTPS', async () => {
            seen.length = 0;

            const result = await new FetchHttpExecutor({ settings: proxied() }).execute({ id: 'p2', method: 'GET', url: `https://localhost:${securePort}/` });

            assert.equal(result.ok && result.response.body, 'secure via tunnel');
            assert.deepEqual(seen, [`CONNECT localhost:${securePort}`]);
        });

        it('não usa o proxy para hosts da lista de exceções', async () => {
            seen.length = 0;

            const result = await new FetchHttpExecutor({ settings: proxied('localhost, 127.0.0.1') }).execute({ id: 'p3', method: 'GET', url: `${baseUrl}/echo` });

            assert.ok(result.ok);
            assert.ok(!result.response.headers.some(([key]) => key === 'x-via-proxy'));
            assert.deepEqual(seen, []);
        });

        it('relata falha de conexão com o proxy', async () => {
            const result = await new FetchHttpExecutor({ settings: http({ proxy: { enabled: true, url: 'http://127.0.0.1:1', bypass: '' } }) }).execute({ id: 'p4', method: 'GET', url: `${baseUrl}/echo` });

            assert.equal(result.ok, false);
            assert.match(!result.ok ? result.error : '', /ECONNREFUSED/);
        });
    });
});

describe('DispatcherProvider', () => {
    it('reaproveita o dispatcher enquanto as preferências não mudam', async () => {
        const provider = new DispatcherProvider();
        const settings = structuredClone(DEFAULT_SETTINGS.http);
        const first = provider.get(settings);

        assert.equal(provider.get(structuredClone(settings)), first);
        assert.notEqual(provider.get({ ...settings, ssl: { ...settings.ssl, verifyCertificates: false } }), first);

        await provider.close();
    });
});
