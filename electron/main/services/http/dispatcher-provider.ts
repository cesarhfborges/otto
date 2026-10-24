import { readFileSync, statSync } from 'node:fs';
import { getCACertificates } from 'node:tls';
import { Agent, Dispatcher, ProxyAgent, Socks5ProxyAgent } from 'undici';
import type { ClientCertificate, HttpSettings } from '../../../shared/models';

type ClientTls = { cert?: Buffer; key?: Buffer; pfx?: Buffer; passphrase?: string };
type TlsOptions = ClientTls & { rejectUnauthorized: boolean; ca: string[] };

const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;

let trustedCertificates: string[] | null = null;

/**
 * CAs embutidas no Node + as instaladas no sistema operacional (o Node, por padrão,
 * ignora as do sistema; sem elas falham proxies corporativos e CAs internas da empresa).
 */
function defaultCertificates(): string[] {
    if (!trustedCertificates) {
        let system: string[] = [];

        try {
            system = getCACertificates('system');
        } catch {
            // Sistema sem repositório de certificados legível: só as CAs embutidas.
        }

        trustedCertificates = [...new Set([...getCACertificates('default'), ...system])];
    }

    return trustedCertificates;
}

/** Lê o certificado de CA adicional; erros viram mensagens claras para o usuário. */
function readCaCertificate(file: string): string {
    let pem: string;

    try {
        pem = readFileSync(file, 'utf8');
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? 'unknown error';

        throw new Error(`Could not read the CA certificate "${file}" (${code}). Check Preferences → Certificates.`);
    }

    if (!PEM_CERTIFICATE.test(pem)) {
        throw new Error(`The CA certificate "${file}" is not a PEM certificate. Check Preferences → Certificates.`);
    }

    return pem;
}

/** Lê um arquivo de certificado/chave de cliente; erros viram mensagens claras para o usuário. */
function readClientFile(file: string, label: string): Buffer {
    try {
        return readFileSync(file);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? 'unknown error';

        throw new Error(`Could not read the client ${label} "${file}" (${code}). Check Preferences → Certificates.`);
    }
}

function clientTls(certificate: ClientCertificate | null): ClientTls {
    if (!certificate) {
        return {};
    }

    const passphrase = certificate.passphrase ? { passphrase: certificate.passphrase } : {};

    if (certificate.pfxPath) {
        return { pfx: readClientFile(certificate.pfxPath, 'PFX file'), ...passphrase };
    }

    return { cert: readClientFile(certificate.certPath!, 'certificate'), key: readClientFile(certificate.keyPath!, 'key'), ...passphrase };
}

function tlsOptions({ ssl }: HttpSettings, certificate: ClientCertificate | null = null): TlsOptions {
    // `ca` substitui a lista padrão do Node; por isso a CA do usuário é somada às demais.
    return {
        rejectUnauthorized: ssl.verifyCertificates,
        ca: ssl.caCertificatePath ? [...defaultCertificates(), readCaCertificate(ssl.caCertificatePath)] : defaultCertificates(),
        ...clientTls(certificate)
    };
}

interface HostPattern {
    hostname: string;
    /** Só subdomínios (`*.example.com`). */
    wildcard: boolean;
    port: string | null;
}

/** `host`, `*.host`, `.host` e `host:porta`; o IPv6 entre colchetes também aceita porta. */
function parseHostPattern(entry: string): HostPattern {
    const match = /^(.*?)(?::(\d+))?$/.exec(entry.trim().toLowerCase())!;
    let hostname = match[1];
    const wildcard = /^\*?\./.test(hostname);

    hostname = hostname.replace(/^\*?\./, '').replace(/^\[|\]$/g, '');

    return { hostname, wildcard, port: match[2] ?? null };
}

function defaultPort(url: URL): string {
    return url.port || (url.protocol === 'https:' ? '443' : '80');
}

function matchesHost(pattern: HostPattern, url: URL, exactToo: boolean): boolean {
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    if (pattern.port && pattern.port !== defaultPort(url)) {
        return false;
    }

    return ((!pattern.wildcard || exactToo) && hostname === pattern.hostname) || hostname.endsWith(`.${pattern.hostname}`);
}

/** Mesma regra do `NO_PROXY`: `*` desliga o proxy; `host` vale também para os subdomínios. */
function bypassesProxy(bypass: string, url: URL): boolean {
    const entries = bypass.split(/[,\s]+/).filter(Boolean);

    return entries.includes('*') || entries.some((entry) => matchesHost(parseHostPattern(entry), url, true));
}

/** `api.example.com` só o próprio host; `*.example.com` só os subdomínios. */
export function clientCertificateFor(certificates: readonly ClientCertificate[], url: URL): ClientCertificate | null {
    return certificates.find((certificate) => matchesHost(parseHostPattern(certificate.host), url, false)) ?? null;
}

function isSocks(proxyUrl: string): boolean {
    return /^socks5?:/i.test(proxyUrl);
}

/** Inclui a data de modificação dos arquivos: trocar um certificado recria o dispatcher. */
function cacheKey({ proxy, ssl }: HttpSettings): string {
    const files = [ssl.caCertificatePath, ...ssl.clientCertificates.flatMap((c) => [c.certPath, c.keyPath, c.pfxPath])].filter((file): file is string => !!file);
    const versions = files.map((file) => {
        try {
            return statSync(file).mtimeMs;
        } catch {
            return -1;
        }
    });

    return JSON.stringify({ proxy, ssl, versions });
}

/**
 * Escolhe, por origem, o agente certo: direto ou pelo proxy (bypass) e com o
 * certificado de cliente do host. Cada combinação tem seu agente (pool), criado na primeira vez.
 */
class RoutingDispatcher extends Dispatcher {
    private readonly agents = new Map<string, Dispatcher>();

    constructor(private readonly settings: HttpSettings) {
        super();
    }

    override dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
        return this.agentFor(new URL(String(options.origin))).dispatch(options, handler);
    }

    override close(): Promise<void>;
    override close(callback: () => void): void;
    override close(callback?: () => void): Promise<void> | void {
        const done = Promise.all([...this.agents.values()].map((agent) => agent.close())).then(() => undefined);

        return callback ? void done.then(callback, callback) : done;
    }

    override destroy(): Promise<void>;
    override destroy(error: Error | null): Promise<void>;
    override destroy(callback: () => void): void;
    override destroy(error: Error | null, callback: () => void): void;
    override destroy(errorOrCallback?: Error | null | (() => void), callback?: () => void): Promise<void> | void {
        const error = typeof errorOrCallback === 'function' ? null : (errorOrCallback ?? null);
        const cb = typeof errorOrCallback === 'function' ? errorOrCallback : callback;
        const done = Promise.all([...this.agents.values()].map((agent) => agent.destroy(error))).then(() => undefined);

        return cb ? void done.then(cb, cb) : done;
    }

    private agentFor(url: URL): Dispatcher {
        const { proxy, ssl } = this.settings;
        const certificate = clientCertificateFor(ssl.clientCertificates, url);
        const proxied = proxy.enabled && !!proxy.url && !bypassesProxy(proxy.bypass, url);
        const key = `${proxied}:${certificate ? ssl.clientCertificates.indexOf(certificate) : -1}`;
        let agent = this.agents.get(key);

        if (!agent) {
            agent = this.create(proxied, certificate);
            this.agents.set(key, agent);
        }

        return agent;
    }

    private create(proxied: boolean, certificate: ClientCertificate | null): Dispatcher {
        const { proxy } = this.settings;
        const tls = tlsOptions(this.settings, certificate);

        if (!proxied) {
            return new Agent({ connect: tls });
        }

        if (isSocks(proxy.url)) {
            // `requestTls` (TLS até o destino, através do túnel) existe no undici, mas falta nos tipos.
            const options: Socks5ProxyAgent.Options & { requestTls: TlsOptions } = { requestTls: tls };

            return new Socks5ProxyAgent(proxy.url.replace(/^socks:/i, 'socks5:'), options);
        }

        return new ProxyAgent({
            uri: proxy.url,
            // HTTP via proxy usa URI absoluta (sem CONNECT), como a maioria dos clientes.
            proxyTunnel: false,
            connect: tls,
            requestTls: tls,
            proxyTls: tlsOptions(this.settings)
        });
    }
}

/**
 * Cria e reaproveita o `Dispatcher` do undici conforme as preferências de proxy e SSL.
 * Mantém um único dispatcher (pool de conexões) enquanto as preferências não mudam;
 * ao mudar, o anterior é fechado depois que suas requisições em andamento terminam.
 */
export class DispatcherProvider {
    private current: { key: string; dispatcher: Dispatcher } | null = null;

    get(settings: HttpSettings): Dispatcher {
        const key = cacheKey(settings);

        if (this.current?.key === key) {
            return this.current.dispatcher;
        }

        const dispatcher = new RoutingDispatcher(settings);
        const previous = this.current;

        this.current = { key, dispatcher };
        previous?.dispatcher.close().catch(() => undefined);

        return dispatcher;
    }

    async close(): Promise<void> {
        const current = this.current;

        this.current = null;
        await current?.dispatcher.destroy().catch(() => undefined);
    }

    /**
     * Agente com uma única conexão, fora do pool e sem proxy, para handshakes presos
     * à conexão (NTLM). Quem pede fecha depois de ler a resposta.
     */
    dedicated(settings: HttpSettings, url: URL): Dispatcher {
        return new Agent({ connect: tlsOptions(settings, clientCertificateFor(settings.ssl.clientCertificates, url)), connections: 1, pipelining: 1 });
    }
}
