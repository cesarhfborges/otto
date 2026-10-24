import type { CollectionCookie } from '../models';
import { parseSetCookie } from '../templating/cookies';

/** `http://localhost:3000/x` ou `.exemplo.com` → `localhost` / `exemplo.com`. */
export function normalizeDomain(domain: string): string {
    const value = domain.trim().toLowerCase();

    if (value.includes('://')) {
        try {
            return new URL(value).hostname;
        } catch {
            return value;
        }
    }

    return value.replace(/^\./, '').replace(/[:/].*$/, '');
}

export const sameCookie = (a: CollectionCookie, b: CollectionCookie): boolean => a.name === b.name && normalizeDomain(a.domain) === normalizeDomain(b.domain) && a.path === b.path;

export const isExpired = (cookie: CollectionCookie, now = Date.now()): boolean => cookie.expires !== null && Date.parse(cookie.expires) <= now;

function domainMatches(cookie: CollectionCookie, host: string): boolean {
    const domain = normalizeDomain(cookie.domain);

    return !domain || host === domain || (!cookie.hostOnly && host.endsWith(`.${domain}`));
}

function pathMatches(cookiePath: string, requestPath: string): boolean {
    const path = cookiePath || '/';

    return requestPath === path || (requestPath.startsWith(path) && (path.endsWith('/') || requestPath[path.length] === '/'));
}

/** Cookies válidos para a URL. */
export function cookiesFor(jar: readonly CollectionCookie[], url: string, now = Date.now()): CollectionCookie[] {
    let parsed: URL;

    try {
        parsed = new URL(url);
    } catch {
        return [];
    }

    return jar.filter((cookie) => !isExpired(cookie, now) && domainMatches(cookie, parsed.hostname) && pathMatches(cookie.path, parsed.pathname) && (!cookie.secure || parsed.protocol === 'https:' || parsed.hostname === 'localhost'));
}

/** Valor do header `Cookie` para a URL (vazio se nenhum). */
export const cookieHeaderFor = (jar: readonly CollectionCookie[], url: string): string =>
    cookiesFor(jar, url)
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; ');

/** Insere ou substitui (mesmo nome, domínio e path); cookies expirados são removidos. */
export function upsertCookie(jar: readonly CollectionCookie[], cookie: CollectionCookie): CollectionCookie[] {
    const rest = jar.filter((item) => !sameCookie(item, cookie));

    return isExpired(cookie) ? rest : [...rest, cookie];
}

/** Aplica os `Set-Cookie` de uma resposta. */
export function applySetCookies(jar: readonly CollectionCookie[], url: string, headers: readonly string[], now = Date.now()): CollectionCookie[] {
    let parsed: URL;

    try {
        parsed = new URL(url);
    } catch {
        return [...jar];
    }

    return headers.reduce<CollectionCookie[]>(
        (acc, header) => {
            const info = parseSetCookie(header);

            if (!info) {
                return acc;
            }

            const maxAge = info.maxAge !== undefined && !Number.isNaN(info.maxAge) ? new Date(now + info.maxAge * 1000).toISOString() : null;
            const expires = maxAge ?? (info.expires && !Number.isNaN(Date.parse(info.expires)) ? info.expires : null);
            const defaultPath = parsed.pathname.slice(0, parsed.pathname.lastIndexOf('/')) || '/';

            return upsertCookie(acc, {
                name: info.name,
                value: info.value,
                domain: info.domain ? normalizeDomain(info.domain) : parsed.hostname,
                path: info.path?.startsWith('/') ? info.path : defaultPath,
                expires,
                secure: info.secure,
                httpOnly: info.httpOnly,
                hostOnly: !info.domain
            });
        },
        [...jar]
    );
}

/** Cookie → linha `Set-Cookie` (aba Raw). */
export function toRawCookie(cookie: CollectionCookie): string {
    return [
        `${cookie.name}=${cookie.value}`,
        cookie.domain && !cookie.hostOnly && `Domain=${cookie.domain}`,
        `Path=${cookie.path || '/'}`,
        cookie.expires && `Expires=${new Date(cookie.expires).toUTCString()}`,
        cookie.secure && 'Secure',
        cookie.httpOnly && 'HttpOnly'
    ]
        .filter(Boolean)
        .join('; ');
}

/** Linha `Set-Cookie` → cookie (`fallbackDomain` quando não há `Domain`). */
export function fromRawCookie(raw: string, fallbackDomain: string): CollectionCookie | null {
    const host = normalizeDomain(fallbackDomain) || 'localhost';
    const [cookie] = applySetCookies([], `http://${host}/`, [raw]);

    return cookie ?? null;
}
