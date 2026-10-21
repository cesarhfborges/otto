import { TemplateError, UnresolvedError } from '../errors';
import { arg, fn, ns, opt, str, type CatalogNode } from '../node';
import { hmacBytes } from './crypto';
import { base64Decode, base64Url } from './encoding';

function decode(token: unknown): { header: Record<string, unknown>; payload: Record<string, unknown> } {
    const [header, payload] = str(token).split('.');

    try {
        const part = (value: string): Record<string, unknown> => JSON.parse(new TextDecoder().decode(base64Decode(value)));

        return { header: part(header ?? ''), payload: part(payload ?? '') };
    } catch {
        throw new TemplateError('Invalid JWT');
    }
}

const json64 = (value: unknown): string => base64Url(new TextEncoder().encode(JSON.stringify(value)));

export const JWT_FUNCTIONS: CatalogNode[] = [
    ns('jwt', 'Decode / sign JWT', [
        fn('decode', 'object', '{ header, payload } (signature is not verified)', [arg('token')], decode),
        fn('claim', 'any', 'One claim of the payload (sub, exp…)', [arg('token'), arg('name', { values: ['sub', 'exp', 'iat', 'iss', 'aud'] })], (token: unknown, name: unknown) => {
            const value = decode(token).payload[str(name)];

            if (value === undefined) {
                throw new UnresolvedError(`Claim "${str(name)}" not found`);
            }

            return value;
        }),
        fn('expiresIn', 'number', 'Seconds until expiration (negative = expired)', [arg('token')], (token: unknown) => Number(decode(token).payload['exp'] ?? 0) - Math.floor(Date.now() / 1000)),
        fn('sign', 'string', 'Sign an HS256/HS384/HS512 token', [arg('payload'), arg('secret'), opt('algorithm', { values: ['HS256', 'HS384', 'HS512'] })], async (payload: unknown, secret: unknown, algorithm: unknown = 'HS256') => {
            const alg = str(algorithm).toUpperCase();
            const content = `${json64({ alg, typ: 'JWT' })}.${json64(typeof payload === 'string' ? JSON.parse(payload) : payload)}`;

            return `${content}.${base64Url(await hmacBytes(`sha${alg.slice(2)}`, secret, content))}`;
        })
    ])
];
