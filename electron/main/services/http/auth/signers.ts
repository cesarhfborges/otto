import { createHash, createHmac, createPrivateKey, createSign, randomBytes, randomUUID, type KeyObject } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import type { FormData } from 'undici';
import type { SendTimeAuth } from '../../../../shared/models';

/** Requisição pronta para envio; os assinadores mexem em headers e URL. */
export interface SignableRequest {
    url: URL;
    method: string;
    headers: Headers;
    body: string | Uint8Array | FormData | undefined;
}

type Auth<T extends SendTimeAuth['type']> = Extract<SendTimeAuth, { type: T }>;

/** Percent-encoding da RFC 3986 (o `encodeURIComponent` deixa `!'()*` de fora). */
const rfc3986 = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const safeDecode = (value: string): string => {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
};

/** Pares da query como estão na URL (decodificados), na ordem. */
const queryPairs = (search: string, plusAsSpace = false): Array<[string, string]> =>
    search
        .replace(/^\?/, '')
        .split('&')
        .filter(Boolean)
        .map((pair) => {
            const [key = '', ...rest] = pair.split('=');
            const decode = (value: string): string => safeDecode(plusAsSpace ? value.replace(/\+/g, ' ') : value);

            return [decode(key), decode(rest.join('='))];
        });

/** Acrescenta parâmetros à query sem reescrever os que já existem. */
function appendQuery(url: URL, pairs: Array<[string, string]>): void {
    const extra = pairs.map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`).join('&');

    url.search = url.search && url.search !== '?' ? `${url.search}&${extra}` : `?${extra}`;
}

const bodyBytes = (body: SignableRequest['body']): Buffer | null => (body === undefined ? Buffer.alloc(0) : typeof body === 'string' ? Buffer.from(body, 'utf8') : body instanceof Uint8Array ? Buffer.from(body) : null);

const defaultPort = (url: URL): string => url.port || (url.protocol === 'https:' ? '443' : '80');

const base64url = (data: Buffer | string): string => Buffer.from(data).toString('base64url');

/** Chave privada em PEM ou em data URI (`data:application/pkcs8;kid=…;base64,…`, formato do ASAP). */
function privateKey(raw: string, label: string): KeyObject {
    const text = raw.trim();

    if (!text) {
        throw new Error(`${label}: enter the private key`);
    }

    try {
        const dataUri = /^data:[^,]*;base64,(.+)$/s.exec(text);

        return dataUri ? createPrivateKey({ key: Buffer.from(dataUri[1]!, 'base64'), format: 'der', type: 'pkcs8' }) : createPrivateKey(text.replace(/\\n/g, '\n'));
    } catch (error) {
        throw new Error(`${label}: invalid private key (${(error as Error).message})`);
    }
}

/** WSSE UsernameToken: digest = base64(sha1(nonce + created + senha)), gerado a cada envio. */
export function signWsse({ headers }: SignableRequest, { username, password }: Auth<'wsse'>): void {
    const nonce = randomBytes(16);
    const created = new Date().toISOString();
    const digest = createHash('sha1')
        .update(Buffer.concat([nonce, Buffer.from(created + password, 'utf8')]))
        .digest('base64');

    headers.set('authorization', 'WSSE profile="UsernameToken"');
    headers.set('x-wsse', `UsernameToken Username="${username}", PasswordDigest="${digest}", Nonce="${nonce.toString('base64')}", Created="${created}"`);
}

/** OAuth 1.0a (RFC 5849): assinatura sobre método, URL base e todos os parâmetros. */
export function signOAuth1({ url, method, headers, body }: SignableRequest, auth: Auth<'oauth1'>): void {
    const oauth: Array<[string, string]> = [
        ['oauth_consumer_key', auth.consumerKey],
        ['oauth_nonce', randomBytes(16).toString('hex')],
        ['oauth_signature_method', auth.signatureMethod],
        ['oauth_timestamp', String(Math.floor(Date.now() / 1000))],
        ['oauth_version', '1.0']
    ];

    if (auth.token) {
        oauth.push(['oauth_token', auth.token]);
    }

    const contentType = headers.get('content-type') ?? '';
    const formParams = typeof body === 'string' && /application\/x-www-form-urlencoded/i.test(contentType) ? queryPairs(body, true) : [];
    const normalized = [...queryPairs(url.search, true), ...formParams, ...oauth]
        .map(([key, value]) => [rfc3986(key), rfc3986(value)] as const)
        .sort(([ka, va], [kb, vb]) => (ka === kb ? (va < vb ? -1 : va > vb ? 1 : 0) : ka < kb ? -1 : 1))
        .map(([key, value]) => `${key}=${value}`)
        .join('&');
    const port = url.port && url.port !== (url.protocol === 'https:' ? '443' : '80') ? `:${url.port}` : '';
    const baseUrl = `${url.protocol}//${url.hostname.toLowerCase()}${port}${url.pathname}`;
    const baseString = [method.toUpperCase(), rfc3986(baseUrl), rfc3986(normalized)].join('&');
    const key = `${rfc3986(auth.consumerSecret)}&${rfc3986(auth.tokenSecret)}`;
    const [family, digest] = auth.signatureMethod.split('-') as [string, string | undefined];
    const algorithm = digest?.toLowerCase() ?? '';

    const signature = family === 'PLAINTEXT' ? key : family === 'HMAC' ? createHmac(algorithm, key).update(baseString).digest('base64') : createSign(`RSA-${digest}`).update(baseString).sign(privateKey(auth.privateKey, 'OAuth 1.0'), 'base64');

    oauth.push(['oauth_signature', signature]);

    if (auth.addTo === 'query') {
        appendQuery(url, oauth);
    } else {
        const realm = auth.realm ? [`realm="${rfc3986(auth.realm)}"`] : [];

        headers.set('authorization', `OAuth ${[...realm, ...oauth.map(([name, value]) => `${name}="${rfc3986(value)}"`)].join(', ')}`);
    }
}

/** AWS Signature Version 4 (headers `Authorization`, `X-Amz-Date` e `X-Amz-Content-Sha256`). */
export function signAwsV4({ url, method, headers, body }: SignableRequest, auth: Auth<'awsv4'>): void {
    if (!auth.accessKeyId || !auth.secretAccessKey || !auth.region || !auth.service) {
        throw new Error('AWS Signature: Access Key, Secret Key, Region and Service are required');
    }

    const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
    const date = amzDate.slice(0, 8);
    const bytes = bodyBytes(body);
    // Multipart é montado pelo fetch (boundary aleatório): o corpo não pode ser assinado.
    const payloadHash = bytes ? createHash('sha256').update(bytes).digest('hex') : 'UNSIGNED-PAYLOAD';

    headers.set('x-amz-date', amzDate);
    headers.set('x-amz-content-sha256', payloadHash);

    if (auth.sessionToken) {
        headers.set('x-amz-security-token', auth.sessionToken);
    }

    // Fora do S3, cada segmento do caminho é codificado duas vezes.
    const encodeSegment = (segment: string): string => (auth.service === 's3' ? rfc3986(safeDecode(segment)) : rfc3986(rfc3986(safeDecode(segment))));
    const canonicalUri = url.pathname.split('/').map(encodeSegment).join('/') || '/';
    const canonicalQuery = queryPairs(url.search)
        .map(([key, value]) => [rfc3986(key), rfc3986(value)] as const)
        .sort(([ka, va], [kb, vb]) => (ka === kb ? (va < vb ? -1 : va > vb ? 1 : 0) : ka < kb ? -1 : 1))
        .map(([key, value]) => `${key}=${value}`)
        .join('&');
    const signed = new Map<string, string>([['host', url.host]]);

    for (const [name, value] of headers) {
        if (name.startsWith('x-amz-') || name === 'content-type') {
            signed.set(name, value.trim().replace(/\s+/g, ' '));
        }
    }

    const names = [...signed.keys()].sort();
    const signedHeaders = names.join(';');
    const canonicalRequest = [method.toUpperCase(), canonicalUri, canonicalQuery, names.map((name) => `${name}:${signed.get(name)}\n`).join(''), signedHeaders, payloadHash].join('\n');
    const scope = `${date}/${auth.region}/${auth.service}/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest();
    const signingKey = [auth.region, auth.service, 'aws4_request'].reduce<Buffer>((key, part) => hmac(key, part), hmac(`AWS4${auth.secretAccessKey}`, date));
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    headers.set('authorization', `AWS4-HMAC-SHA256 Credential=${auth.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`);
}

/** Hawk (header `Authorization: Hawk id=…, ts=…, nonce=…, mac=…`), sem hash do corpo. */
export function signHawk({ url, method, headers }: SignableRequest, auth: Auth<'hawk'>): void {
    if (!auth.id || !auth.key) {
        throw new Error('Hawk: Auth ID and Auth Key are required');
    }

    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(6).toString('base64url');
    const normalized = ['hawk.1.header', ts, nonce, method.toUpperCase(), `${url.pathname}${url.search}`, url.hostname.toLowerCase(), defaultPort(url), '', auth.ext.replace(/\\/g, '\\\\').replace(/\n/g, '\\n'), ''].join('\n');
    const mac = createHmac(auth.algorithm, auth.key).update(normalized).digest('base64');
    const ext = auth.ext ? `, ext="${auth.ext.replace(/(["\\])/g, '\\$1')}"` : '';

    headers.set('authorization', `Hawk id="${auth.id}", ts="${ts}", nonce="${nonce}"${ext}, mac="${mac}"`);
}

/** Atlassian ASAP: JWT RS256 de curta duração no `Authorization: Bearer`. */
export function signAsap({ headers }: SignableRequest, auth: Auth<'asap'>): void {
    if (!auth.issuer || !auth.audience || !auth.keyId) {
        throw new Error('Atlassian ASAP: Issuer, Audience and Key ID are required');
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresIn = Number(auth.expiresIn) > 0 ? Math.floor(Number(auth.expiresIn)) : 3600;
    // Várias audiências separadas por vírgula viram uma lista no JWT.
    const audiences = auth.audience
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const header = { alg: 'RS256', typ: 'JWT', kid: auth.keyId };
    const payload = {
        iss: auth.issuer,
        ...(auth.subject && { sub: auth.subject }),
        aud: audiences.length > 1 ? audiences : audiences[0],
        iat: now,
        exp: now + expiresIn,
        jti: randomUUID()
    };
    const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey(auth.privateKey, 'Atlassian ASAP'));

    headers.set('authorization', `Bearer ${unsigned}.${base64url(signature)}`);
}

/** Entradas do `.netrc` (`machine`/`default` com `login` e `password`). */
function parseNetrc(content: string): Array<{ machine: string | null; login: string; password: string }> {
    const tokens = content
        .replace(/^\s*#.*$/gm, '')
        .split(/\s+/)
        .filter(Boolean);
    const entries: Array<{ machine: string | null; login: string; password: string }> = [];
    let current: { machine: string | null; login: string; password: string } | null = null;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (token === 'machine' || token === 'default') {
            current = { machine: token === 'machine' ? (tokens[++i] ?? '') : null, login: '', password: '' };
            entries.push(current);
        } else if (current && (token === 'login' || token === 'password')) {
            current[token] = tokens[++i] ?? '';
        } else if (token === 'account') {
            i++;
        } else if (token === 'macdef') {
            // Macro até a próxima linha em branco: sem tokens úteis para autenticação.
            current = null;
        }
    }

    return entries;
}

/** Credenciais do `.netrc` para o host como Basic Auth. Retorna o arquivo lido (ou `null`, se nenhum casou). */
export async function signNetrc({ url, headers }: SignableRequest): Promise<string | null> {
    const candidates = process.env['NETRC'] ? [process.env['NETRC']] : [path.join(homedir(), '.netrc'), path.join(homedir(), '_netrc')];

    for (const file of candidates) {
        let content: string;

        try {
            content = await readFile(file, 'utf8');
        } catch {
            continue;
        }

        const entries = parseNetrc(content);
        const entry = entries.find((item) => item.machine?.toLowerCase() === url.hostname.toLowerCase()) ?? entries.find((item) => item.machine === null);

        if (entry) {
            headers.set('authorization', `Basic ${Buffer.from(`${entry.login}:${entry.password}`, 'utf8').toString('base64')}`);

            return file;
        }

        return null;
    }

    return null;
}
