export interface CookieInfo {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: string;
    maxAge?: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite?: string;
}

/** `Set-Cookie: nome=valor; Path=/; HttpOnly…` → detalhes do cookie. */
export function parseSetCookie(header: string): CookieInfo | null {
    const [pair = '', ...attributes] = header.split(';');
    const separator = pair.indexOf('=');

    if (separator <= 0) {
        return null;
    }

    const info: CookieInfo = { name: pair.slice(0, separator).trim(), value: pair.slice(separator + 1).trim(), httpOnly: false, secure: false };

    for (const attribute of attributes) {
        const [rawKey = '', ...rest] = attribute.split('=');
        const key = rawKey.trim().toLowerCase();
        const value = rest.join('=').trim();

        if (key === 'domain' || key === 'path') {
            info[key] = value;
        } else if (key === 'expires') {
            const date = new Date(value);

            info.expires = Number.isNaN(date.getTime()) ? value : date.toISOString();
        } else if (key === 'max-age') {
            info.maxAge = Number(value);
        } else if (key === 'httponly') {
            info.httpOnly = true;
        } else if (key === 'secure') {
            info.secure = true;
        } else if (key === 'samesite') {
            info.sameSite = value;
        }
    }

    return info;
}

/** Header `Cookie: a=1; b=2` → pares. */
export const parseCookieHeader = (header: string): Array<[string, string]> =>
    header
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part.includes('='))
        .map((part) => [part.slice(0, part.indexOf('=')), part.slice(part.indexOf('=') + 1)]);

/** Conjunto de cookies. No template vira `a=1; b=2` (pronto para o header `Cookie`). */
export class Cookies {
    constructor(private readonly items: ReadonlyArray<[string, string]>) {}

    get(name: string): string | undefined {
        return this.items.find(([key]) => key === name)?.[1];
    }

    has(name: string): boolean {
        return this.get(name) !== undefined;
    }

    all(): Array<{ name: string; value: string }> {
        return this.items.map(([name, value]) => ({ name, value }));
    }

    toObject(): Record<string, string> {
        return Object.fromEntries(this.items);
    }

    toTemplateString(): string {
        return this.items.map(([name, value]) => `${name}=${value}`).join('; ');
    }
}

/** Headers com repetição (`Set-Cookie`…). No template vira JSON `{ "nome": "valor" }`. */
export class HeaderList {
    constructor(private readonly items: ReadonlyArray<[string, string]>) {}

    all(name: string): string[] {
        const wanted = name.toLowerCase();

        return this.items.filter(([key]) => key.toLowerCase() === wanted).map(([, value]) => value);
    }

    get(name: string): string | undefined {
        const values = this.all(name);

        if (!values.length) {
            return undefined;
        }

        return name.toLowerCase() === 'set-cookie' ? values[0] : values.join(', ');
    }

    has(name: string): boolean {
        return this.all(name).length > 0;
    }

    toObject(): Record<string, string> {
        return Object.fromEntries(this.items.map(([key]) => [key.toLowerCase(), this.get(key)!]));
    }

    toJSON(): Record<string, string> {
        return this.toObject();
    }
}
