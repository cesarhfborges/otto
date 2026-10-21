import { createHash, randomBytes } from 'node:crypto';

const ALGORITHMS: Record<string, string> = { md5: 'md5', 'sha-256': 'sha256', 'sha-512-256': 'sha512-256' };

/** Parâmetros `chave=valor` / `chave="valor"` de um `WWW-Authenticate`. */
export function parseChallengeParams(header: string): Record<string, string> {
    const params: Record<string, string> = {};

    for (const match of header.matchAll(/([\w-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g)) {
        // Outros esquemas juntados depois (`…, Basic realm="x"`) não sobrescrevem os do primeiro.
        params[match[1]!.toLowerCase()] ??= match[2] !== undefined ? match[2].replace(/\\(.)/g, '$1') : match[3]!;
    }

    return params;
}

/**
 * Desafio do esquema dado (`Digest`, `NTLM`…) entre os headers `WWW-Authenticate`.
 * O `fetch` junta headers repetidos com `, `, então o esquema pode estar no meio do valor.
 */
export function findChallenge(headers: Array<[string, string]>, scheme: string): string | null {
    const pattern = new RegExp(`(?:^|,\\s*)(${scheme}(?:\\s.*)?)$`, 'i');

    for (const [name, value] of headers) {
        const match = name.toLowerCase() === 'www-authenticate' ? pattern.exec(value.trim()) : null;

        if (match) {
            return match[1]!;
        }
    }

    return null;
}

interface DigestInput {
    username: string;
    password: string;
    method: string;
    /** Caminho + query da URL. */
    uri: string;
    /** Corpo em texto, usado só em `qop=auth-int`. */
    body?: string;
}

/** Monta o `Authorization: Digest …` (RFC 7616) para o desafio recebido. */
export function digestAuthorization(challenge: string, { username, password, method, uri, body }: DigestInput): string {
    const params = parseChallengeParams(challenge.replace(/^Digest\s+/i, ''));
    const algorithm = params['algorithm'] ?? 'MD5';
    const session = /-sess$/i.test(algorithm);
    const hashName = ALGORITHMS[algorithm.toLowerCase().replace(/-sess$/, '')];

    if (!hashName) {
        throw new Error(`Unsupported Digest algorithm "${algorithm}"`);
    }

    const hash = (text: string): string => createHash(hashName).update(text, 'utf8').digest('hex');
    const realm = params['realm'] ?? '';
    const nonce = params['nonce'] ?? '';
    const offered = (params['qop'] ?? '').split(',').map((value) => value.trim().toLowerCase());
    const qop = offered.includes('auth') ? 'auth' : offered.includes('auth-int') && body !== undefined ? 'auth-int' : '';
    const cnonce = randomBytes(16).toString('hex');
    const nc = '00000001';

    let ha1 = hash(`${username}:${realm}:${password}`);

    if (session) {
        ha1 = hash(`${ha1}:${nonce}:${cnonce}`);
    }

    const ha2 = hash(qop === 'auth-int' ? `${method}:${uri}:${hash(body ?? '')}` : `${method}:${uri}`);
    const response = qop ? hash(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : hash(`${ha1}:${nonce}:${ha2}`);
    const quote = (value: string): string => `"${value.replace(/(["\\])/g, '\\$1')}"`;
    const parts = [`username=${quote(username)}`, `realm=${quote(realm)}`, `nonce=${quote(nonce)}`, `uri=${quote(uri)}`, `algorithm=${algorithm}`, `response=${quote(response)}`];

    if (qop) {
        parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce=${quote(cnonce)}`);
    }

    if (params['opaque'] !== undefined) {
        parts.push(`opaque=${quote(params['opaque'])}`);
    }

    return `Digest ${parts.join(', ')}`;
}
