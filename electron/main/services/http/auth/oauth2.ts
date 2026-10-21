import { createHash, randomBytes } from 'node:crypto';
import { fetch, type Dispatcher } from 'undici';
import type { SendTimeAuth } from '../../../../shared/models';

type OAuth2Auth = Extract<SendTimeAuth, { type: 'oauth2' }>;

/**
 * Abre a página de autorização e resolve com a URL de callback para a qual o
 * provedor redirecionou (com `code` ou `access_token`).
 */
export type OAuth2Authorizer = (authorizationUrl: string, callbackUrl: string, signal: AbortSignal) => Promise<string>;

export interface CachedToken {
    accessToken: string;
    tokenType: string;
    refreshToken?: string;
    /** `null` quando o provedor não informa a validade. */
    expiresAt: number | null;
}

/** Margem para não enviar um token prestes a expirar. */
const EXPIRY_MARGIN_MS = 30_000;

/** Campos que identificam o token: mudar qualquer um deles pede um novo. */
const cacheKey = (auth: OAuth2Auth): string => JSON.stringify([auth.grantType, auth.authUrl, auth.accessTokenUrl, auth.callbackUrl, auth.clientId, auth.clientSecret, auth.username, auth.password, auth.scope, auth.pkce, auth.clientAuth]);

function toToken(data: Record<string, unknown>): CachedToken {
    const accessToken = data['access_token'];

    if (typeof accessToken !== 'string' || !accessToken) {
        const error = typeof data['error'] === 'string' ? data['error'] : 'no access_token in the response';
        const description = typeof data['error_description'] === 'string' ? `: ${data['error_description']}` : '';

        throw new Error(`OAuth 2.0: ${error}${description}`);
    }

    const expiresIn = Number(data['expires_in']);

    return {
        accessToken,
        tokenType: typeof data['token_type'] === 'string' ? data['token_type'] : 'Bearer',
        ...(typeof data['refresh_token'] === 'string' && { refreshToken: data['refresh_token'] }),
        expiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : null
    };
}

function requireUrl(value: string, label: string): URL {
    try {
        return new URL(value);
    } catch {
        throw new Error(`OAuth 2.0: enter a valid ${label}`);
    }
}

/**
 * Obtém e guarda em memória os tokens OAuth 2.0 (nada vai para a coleção).
 * Token expirado é renovado com o `refresh_token`, se houver; senão, pedido de novo.
 */
export class OAuth2TokenProvider {
    private readonly cache = new Map<string, CachedToken>();

    constructor(private readonly authorizer?: OAuth2Authorizer) {}

    /** `Authorization` ou parâmetro de query com o token. */
    static apply(auth: OAuth2Auth, token: CachedToken, target: { url: URL; headers: Headers }): void {
        if (auth.addTo === 'query') {
            const pair = `access_token=${encodeURIComponent(token.accessToken)}`;

            target.url.search = target.url.search && target.url.search !== '?' ? `${target.url.search}&${pair}` : `?${pair}`;
        } else {
            target.headers.set('authorization', `${auth.tokenPrefix.trim() || 'Bearer'} ${token.accessToken}`);
        }
    }

    clear(): void {
        this.cache.clear();
    }

    /** Token em cache, renovado ou novo (pode abrir a janela de login: sem timeout da requisição). */
    async token(auth: OAuth2Auth, dispatcher: Dispatcher, signal: AbortSignal, log: (text: string) => void): Promise<CachedToken> {
        const key = cacheKey(auth);
        const cached = this.cache.get(key);

        if (cached && (cached.expiresAt === null || cached.expiresAt - EXPIRY_MARGIN_MS > Date.now())) {
            log('OAuth 2.0: using cached access token');

            return cached;
        }

        let token: CachedToken | null = null;

        if (cached?.refreshToken && auth.grantType !== 'implicit') {
            log('OAuth 2.0: access token expired, refreshing it');

            try {
                token = await this.requestToken(auth, { grant_type: 'refresh_token', refresh_token: cached.refreshToken }, dispatcher, signal);
                token.refreshToken ??= cached.refreshToken;
            } catch (error) {
                log(`OAuth 2.0: refresh failed (${(error as Error).message}), requesting a new token`);
            }
        }

        token ??= await this.newToken(auth, dispatcher, signal, log);
        this.cache.set(key, token);

        return token;
    }

    private async newToken(auth: OAuth2Auth, dispatcher: Dispatcher, signal: AbortSignal, log: (text: string) => void): Promise<CachedToken> {
        const scope: Record<string, string> = auth.scope ? { scope: auth.scope } : {};

        switch (auth.grantType) {
            case 'client_credentials':
                log('OAuth 2.0: requesting access token (client credentials)');

                return this.requestToken(auth, { grant_type: 'client_credentials', ...scope }, dispatcher, signal);
            case 'password':
                log('OAuth 2.0: requesting access token (password)');

                return this.requestToken(auth, { grant_type: 'password', username: auth.username, password: auth.password, ...scope }, dispatcher, signal);
            case 'authorization_code': {
                const verifier = randomBytes(32).toString('base64url');
                const extra: Record<string, string> = auth.pkce ? { code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' } : {};
                const callback = await this.authorize(auth, 'code', extra, signal, log);
                const code = callback.searchParams.get('code');

                if (!code) {
                    throw new Error('OAuth 2.0: the authorization server did not return a code');
                }

                log('OAuth 2.0: exchanging authorization code for an access token');

                return this.requestToken(auth, { grant_type: 'authorization_code', code, redirect_uri: auth.callbackUrl, ...(auth.pkce && { code_verifier: verifier }) }, dispatcher, signal);
            }
            case 'implicit': {
                const callback = await this.authorize(auth, 'token', {}, signal, log);

                return toToken(Object.fromEntries(new URLSearchParams(callback.hash.replace(/^#/, ''))));
            }
        }
    }

    /** Abre a janela de login e valida o `state` do retorno. */
    private async authorize(auth: OAuth2Auth, responseType: 'code' | 'token', extra: Record<string, string>, signal: AbortSignal, log: (text: string) => void): Promise<URL> {
        if (!this.authorizer) {
            throw new Error('OAuth 2.0: interactive authorization is not available');
        }

        const url = requireUrl(auth.authUrl, 'Authorization URL');

        requireUrl(auth.callbackUrl, 'Callback URL');

        const state = randomBytes(16).toString('hex');
        const params = { response_type: responseType, client_id: auth.clientId, redirect_uri: auth.callbackUrl, state, ...(auth.scope && { scope: auth.scope }), ...extra };

        for (const [name, value] of Object.entries(params)) {
            url.searchParams.set(name, value);
        }

        log('OAuth 2.0: waiting for authorization in the login window');

        const callback = new URL(await this.authorizer(url.toString(), auth.callbackUrl, signal));
        const returned = new URLSearchParams([...callback.searchParams, ...new URLSearchParams(callback.hash.replace(/^#/, ''))]);
        const error = returned.get('error');

        if (error) {
            throw new Error(`OAuth 2.0: ${error}${returned.get('error_description') ? `: ${returned.get('error_description')}` : ''}`);
        }

        if (returned.get('state') !== state) {
            throw new Error('OAuth 2.0: the returned state does not match (possible CSRF)');
        }

        return callback;
    }

    /** POST no endpoint de token (`application/x-www-form-urlencoded`). */
    private async requestToken(auth: OAuth2Auth, params: Record<string, string>, dispatcher: Dispatcher, signal: AbortSignal): Promise<CachedToken> {
        const url = requireUrl(auth.accessTokenUrl, 'Access Token URL');
        const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
        const body = new URLSearchParams(params);

        if (auth.clientAuth === 'header' && auth.clientId) {
            headers['authorization'] = `Basic ${Buffer.from(`${encodeURIComponent(auth.clientId)}:${encodeURIComponent(auth.clientSecret)}`).toString('base64')}`;
        } else {
            body.set('client_id', auth.clientId);

            if (auth.clientSecret) {
                body.set('client_secret', auth.clientSecret);
            }
        }

        const res = await fetch(url, { method: 'POST', headers, body: body.toString(), signal, dispatcher });
        const text = await res.text();
        let data: Record<string, unknown>;

        try {
            data = JSON.parse(text) as Record<string, unknown>;
        } catch {
            // Alguns provedores (GitHub, por padrão) respondem em form-urlencoded.
            data = Object.fromEntries(new URLSearchParams(text));
        }

        if (!res.ok && !data['error']) {
            throw new Error(`OAuth 2.0: token request failed with HTTP ${res.status}`);
        }

        return toToken(data);
    }
}
