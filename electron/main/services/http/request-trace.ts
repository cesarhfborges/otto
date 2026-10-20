import { AsyncLocalStorage } from 'node:async_hooks';
import { subscribe } from 'node:diagnostics_channel';
import type { Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import type { FormData } from 'undici';
import type { HttpTimelineEntry } from '../../../shared/models';

/** Corpos enviados maiores que isso aparecem resumidos no console. */
const MAX_LOGGED_BODY_CHARS = 64 * 1024;

interface ConnectParams {
    hostname: string;
    port: string;
    protocol: string;
    version?: 'h1' | 'h2';
}

interface Connection {
    id: number;
    host: string;
    version: string;
}

/**
 * Console de uma execução (Timeline). Os eventos de rede chegam pelos `diagnostics_channel`
 * do undici; o `AsyncLocalStorage` diz a qual execução cada evento pertence, mesmo com
 * várias requisições simultâneas.
 */
export class RequestTrace {
    readonly entries: HttpTimelineEntry[] = [];
    /** `Content-Length` calculado por nós: o undici o escreve fora do bloco de headers publicado. */
    contentLength: number | null = null;
    /** Corpo enviado já resumido em linhas (`|`), registrado logo após os headers. */
    bodyLines: string[] = [];
    connection: Connection | null = null;
    private readonly opened = new WeakSet<Socket>();

    info(text: string): void {
        this.entries.push({ kind: 'info', text });
    }

    error(text: string): void {
        this.entries.push({ kind: 'error', text });
    }

    requestHead(lines: string[]): void {
        for (const text of lines) {
            this.entries.push({ kind: 'request-header', text });
        }

        for (const text of this.bodyLines) {
            this.entries.push({ kind: 'request-body', text });
        }
    }

    responseHead(version: string, status: number, statusText: string, headers: Array<[string, string]>): void {
        this.entries.push({ kind: 'response-header', text: `${version} ${status} ${statusText}`.trim() });

        for (const [name, value] of headers) {
            this.entries.push({ kind: 'response-header', text: `${name}: ${value}` });
        }
    }

    /** Resume o corpo enviado para o console. */
    describeBody(body: string | Uint8Array | FormData | undefined, file?: string): void {
        if (body === undefined) {
            return;
        }

        if (typeof body === 'string') {
            this.contentLength = Buffer.byteLength(body);
            this.bodyLines = body.length > MAX_LOGGED_BODY_CHARS ? [...body.slice(0, MAX_LOGGED_BODY_CHARS).split(/\r?\n/), `[${body.length - MAX_LOGGED_BODY_CHARS} more characters not shown]`] : body.split(/\r?\n/);
        } else if (body instanceof Uint8Array) {
            this.contentLength = body.byteLength;
            this.bodyLines = [`[binary file${file ? ` "${file}"` : ''}, ${body.byteLength} bytes]`];
        } else {
            this.bodyLines = ['[multipart/form-data]', ...[...body.entries()].map(([name, value]) => (typeof value === 'string' ? `${name}: ${value}` : `${name}: <file "${value.name}", ${value.size} bytes>`))];
        }
    }

    /** Executa `send` registrando os eventos de rede do undici nesta execução. */
    run<T>(send: () => Promise<T>): Promise<T> {
        listen();

        return storage.run(this, send);
    }

    onConnecting(params: ConnectParams): void {
        this.info(`Trying ${params.hostname}:${portOf(params)}...`);
    }

    onConnected(params: ConnectParams, socket: Socket): void {
        const { hostname, version } = params;
        const id = ++connectionCount;
        const connection: Connection = { id, host: hostname, version: version === 'h2' ? 'HTTP/2' : 'HTTP/1.1' };

        connections.set(socket, connection);
        this.opened.add(socket);
        this.connection = connection;
        this.info(`Connected to ${hostname} (${socket.remoteAddress ?? 'unknown address'}) port ${portOf(params)} (#${id})`);

        if ('getProtocol' in socket) {
            this.describeTls(socket as TLSSocket);
        }
    }

    onConnectError(params: ConnectParams, error: Error & { code?: string }): void {
        this.info(`connect to ${params.hostname} port ${portOf(params)} failed: ${error.code ?? error.message}`);
    }

    onSendHeaders(rawHeaders: string, socket: Socket): void {
        const connection = connections.get(socket);

        if (connection && !this.opened.has(socket)) {
            this.connection = connection;
            this.info(`Re-using existing connection #${connection.id} with host ${connection.host}`);
        }

        const lines = rawHeaders.split('\r\n').filter(Boolean);

        if (this.contentLength !== null && !lines.some((line) => /^content-length:/i.test(line))) {
            lines.push(`content-length: ${this.contentLength}`);
        }

        this.requestHead(lines);
    }

    onResponseHeaders(statusCode: number, statusText: string, rawHeaders: Buffer[]): void {
        const headers: Array<[string, string]> = [];

        for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
            headers.push([rawHeaders[i]!.toString('latin1'), rawHeaders[i + 1]!.toString('latin1')]);
        }

        this.responseHead(this.connection?.version ?? 'HTTP/1.1', statusCode, statusText, headers);
    }

    private describeTls(socket: TLSSocket): void {
        const cipher = socket.getCipher();
        const certificate = socket.getPeerCertificate();

        this.info(`TLS connection using ${socket.getProtocol() ?? 'unknown protocol'} / ${cipher.name}`);

        if (socket.alpnProtocol) {
            this.info(`ALPN: server accepted ${socket.alpnProtocol}`);
        }

        if (certificate?.subject) {
            this.info('Server certificate:');
            this.info(`  subject: ${formatDistinguishedName(certificate.subject)}`);
            this.info(`  start date: ${certificate.valid_from}`);
            this.info(`  expire date: ${certificate.valid_to}`);

            if (certificate.subjectaltname) {
                this.info(`  subjectAltName: ${certificate.subjectaltname}`);
            }

            this.info(`  issuer: ${formatDistinguishedName(certificate.issuer)}`);
        }

        this.info(socket.authorized ? 'SSL certificate verify ok.' : `SSL certificate verify result: ${String(socket.authorizationError ?? 'not verified')}, continuing anyway.`);
    }
}

const portOf = ({ port, protocol }: ConnectParams): string => port || (protocol === 'https:' ? '443' : '80');

const formatDistinguishedName = (name: Record<string, string | string[] | undefined>): string =>
    Object.entries(name)
        .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join('+') : value}`)
        .join('; ');

const storage = new AsyncLocalStorage<RequestTrace>();
const connections = new WeakMap<Socket, Connection>();
let connectionCount = 0;
let listening = false;

/** Assina os canais uma única vez; eventos fora de uma execução (sem trace) são ignorados. */
function listen(): void {
    if (listening) {
        return;
    }

    listening = true;

    const on = <T>(channel: string, handler: (trace: RequestTrace, message: T) => void): void =>
        subscribe(channel, (message) => {
            const trace = storage.getStore();

            if (trace) {
                handler(trace, message as T);
            }
        });

    on<{ connectParams: ConnectParams }>('undici:client:beforeConnect', (trace, { connectParams }) => trace.onConnecting(connectParams));
    on<{ connectParams: ConnectParams; socket: Socket }>('undici:client:connected', (trace, { connectParams, socket }) => trace.onConnected(connectParams, socket));
    on<{ connectParams: ConnectParams; error: Error }>('undici:client:connectError', (trace, { connectParams, error }) => trace.onConnectError(connectParams, error));
    on<{ headers: string; socket: Socket }>('undici:client:sendHeaders', (trace, { headers, socket }) => trace.onSendHeaders(headers, socket));
    on<{ response: { statusCode: number; statusText: string; headers: Buffer[] } }>('undici:request:headers', (trace, { response }) => trace.onResponseHeaders(response.statusCode, response.statusText, response.headers));
}
