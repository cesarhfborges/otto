import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { EntityId, MockHit, MockServerStatus, RequestDefinition } from '../../../shared/models';
import { buildRoutes, matchRoute, type MockRoute, pickExample, renderMockTemplate } from './mock-routes';

/** Só escuta na própria máquina: o mock nunca fica exposto na rede. */
const HOST = '127.0.0.1';
const MAX_HITS = 100;
const MAX_REQUEST_BODY = 1_000_000;

export interface MockRequestSource {
    requests(collectionId: EntityId): Promise<Array<{ path: string; request: RequestDefinition }>>;
    onChanged(listener: (collectionId: EntityId) => void): () => void;
}

interface RunningMock {
    server: Server;
    port: number;
    /** Rotas em cache; `null` = reler a coleção na próxima chamada. */
    routes: MockRoute[] | null;
    routeCount: number;
    hits: MockHit[];
}

function readBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;

        request.on('data', (chunk: Buffer) => {
            size += chunk.length;

            if (size <= MAX_REQUEST_BODY) {
                chunks.push(chunk);
            }
        });
        request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        request.on('error', reject);
    });
}

const parseJson = (text: string): unknown => {
    try {
        return JSON.parse(text);
    } catch {
        return text || null;
    }
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mock server local por coleção: cada requisição com respostas de exemplo vira uma
 * rota (`MÉTODO /caminho`). Lê os arquivos da coleção sob demanda e recarrega quando
 * eles mudam no disco. Responde com CORS liberado para uso por front-ends locais.
 */
export class MockServerService {
    private readonly running = new Map<EntityId, RunningMock>();
    private readonly unsubscribe: () => void;

    constructor(
        private readonly source: MockRequestSource,
        private readonly onChanged: (servers: MockServerStatus[]) => void
    ) {
        this.unsubscribe = source.onChanged((collectionId) => {
            const mock = this.running.get(collectionId);

            if (mock) {
                mock.routes = null;
                void this.routes(collectionId, mock).then(() => this.emit());
            }
        });
    }

    list(): MockServerStatus[] {
        return [...this.running.entries()].map(([collectionId, mock]) => this.status(collectionId, mock));
    }

    async start(collectionId: EntityId, port: number): Promise<MockServerStatus> {
        const current = this.running.get(collectionId);

        if (current?.port === port) {
            return this.status(collectionId, current);
        }

        await this.stop(collectionId);

        const mock: RunningMock = { server: createServer(), port, routes: null, routeCount: 0, hits: [] };

        mock.server.on('request', (request, response) => void this.handle(collectionId, mock, request, response));

        await new Promise<void>((resolve, reject) => {
            const fail = (error: NodeJS.ErrnoException): void => reject(new Error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use` : error.code === 'EACCES' ? `Permission denied to use port ${port}` : error.message));

            mock.server.once('error', fail);
            mock.server.listen(port, HOST, () => {
                mock.server.off('error', fail);
                resolve();
            });
        });

        mock.port = (mock.server.address() as AddressInfo).port;
        this.running.set(collectionId, mock);
        await this.routes(collectionId, mock);
        this.emit();

        return this.status(collectionId, mock);
    }

    async stop(collectionId: EntityId): Promise<void> {
        const mock = this.running.get(collectionId);

        if (!mock) {
            return;
        }

        this.running.delete(collectionId);
        mock.server.closeAllConnections();
        await new Promise<void>((resolve) => mock.server.close(() => resolve()));
        this.emit();
    }

    async dispose(): Promise<void> {
        this.unsubscribe();
        await Promise.all([...this.running.keys()].map((id) => this.stop(id)));
    }

    private async routes(collectionId: EntityId, mock: RunningMock): Promise<MockRoute[]> {
        if (!mock.routes) {
            try {
                mock.routes = buildRoutes(await this.source.requests(collectionId));
            } catch {
                // Coleção fechada ou ilegível: sem rotas até a próxima mudança.
                mock.routes = [];
            }

            mock.routeCount = mock.routes.length;
        }

        return mock.routes;
    }

    private async handle(collectionId: EntityId, mock: RunningMock, request: IncomingMessage, response: ServerResponse): Promise<void> {
        const url = new URL(request.url ?? '/', `http://${HOST}`);
        const method = (request.method ?? 'GET').toUpperCase();
        const origin = request.headers.origin;

        response.setHeader('Access-Control-Allow-Origin', origin ?? '*');
        response.setHeader('Access-Control-Allow-Credentials', 'true');
        response.setHeader('Access-Control-Expose-Headers', '*');
        response.setHeader('X-Powered-By', 'Otto Mock');

        const record = (status: number, requestPath: string | null, example: string | null): void => {
            mock.hits = [{ at: new Date().toISOString(), method, path: url.pathname + url.search, status, requestPath, example }, ...mock.hits].slice(0, MAX_HITS);
            this.emit();
        };

        try {
            const match = matchRoute(await this.routes(collectionId, mock), method, url.pathname);

            // Preflight do navegador quando não há rota OPTIONS própria.
            if (!match && method === 'OPTIONS') {
                response.writeHead(204, {
                    'Access-Control-Allow-Methods': request.headers['access-control-request-method'] ?? 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
                    'Access-Control-Allow-Headers': request.headers['access-control-request-headers'] ?? '*',
                    'Access-Control-Max-Age': '600'
                });
                response.end();
                record(204, null, null);

                return;
            }

            if (!match) {
                const routes = (mock.routes ?? []).map((route) => `${route.method} ${route.pattern}`);

                response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                response.end(JSON.stringify({ error: `No mock for ${method} ${url.pathname}`, hint: 'Add a response example to a request of this collection.', routes }, null, 2));
                record(404, null, null);

                return;
            }

            const wanted = (request.headers['x-otto-example'] as string | undefined) ?? url.searchParams.get('__example');
            const example = pickExample(match.route.examples, wanted);

            if (!example) {
                response.writeHead(500).end();
                record(500, match.route.requestPath, null);

                return;
            }

            const context = { params: match.params, query: url.searchParams, headers: request.headers, body: parseJson(await readBody(request)) };

            if (example.delayMs > 0) {
                await delay(example.delayMs);
            }

            for (const header of example.headers) {
                if (header.enabled && header.key.trim()) {
                    response.setHeader(header.key.trim(), renderMockTemplate(header.value, context));
                }
            }

            response.statusCode = example.status;
            response.end(method === 'HEAD' ? undefined : renderMockTemplate(example.body, context));
            record(example.status, match.route.requestPath, example.name);
        } catch (error) {
            if (!response.headersSent) {
                response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            }

            response.end(`Otto mock error: ${error instanceof Error ? error.message : String(error)}`);
            record(500, null, null);
        }
    }

    private status(collectionId: EntityId, mock: RunningMock): MockServerStatus {
        return { collectionId, port: mock.port, url: `http://${HOST}:${mock.port}`, routes: mock.routeCount, hits: mock.hits };
    }

    private emit(): void {
        this.onChanged(this.list());
    }
}
