import { readFileSync, statSync } from 'node:fs';
import { getCACertificates } from 'node:tls';
import { Agent, EnvHttpProxyAgent, type Dispatcher } from 'undici';
import type { HttpSettings } from '../../../shared/models';

type TlsOptions = { rejectUnauthorized: boolean; ca: string[] };

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

function tlsOptions({ ssl }: HttpSettings): TlsOptions {
    // `ca` substitui a lista padrão do Node; por isso a CA do usuário é somada às demais.
    return {
        rejectUnauthorized: ssl.verifyCertificates,
        ca: ssl.caCertificatePath ? [...defaultCertificates(), readCaCertificate(ssl.caCertificatePath)] : defaultCertificates()
    };
}

/** Inclui a data de modificação do certificado: trocar o arquivo recria o dispatcher. */
function cacheKey({ proxy, ssl }: HttpSettings): string {
    let caVersion = 0;

    if (ssl.caCertificatePath) {
        try {
            caVersion = statSync(ssl.caCertificatePath).mtimeMs;
        } catch {
            caVersion = -1;
        }
    }

    return JSON.stringify({ proxy, ssl, caVersion });
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

        const dispatcher = this.create(settings);
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
    dedicated(settings: HttpSettings): Dispatcher {
        return new Agent({ connect: tlsOptions(settings), connections: 1, pipelining: 1 });
    }

    private create(settings: HttpSettings): Dispatcher {
        const { proxy } = settings;
        const tls = tlsOptions(settings);

        if (!proxy.enabled || !proxy.url) {
            return new Agent({ connect: tls });
        }

        return new EnvHttpProxyAgent({
            httpProxy: proxy.url,
            httpsProxy: proxy.url,
            // Sempre string: evita cair nas variáveis de ambiente NO_PROXY do sistema.
            noProxy: proxy.bypass,
            // HTTP via proxy usa URI absoluta (sem CONNECT), como a maioria dos clientes.
            proxyTunnel: false,
            connect: tls,
            requestTls: tls,
            proxyTls: tls
        });
    }
}
