import { TemplateError } from '../errors';
import { arg, fn, opt, str, type CatalogNode } from '../node';
import { base64Encode, toHex } from './encoding';

export const HASH_ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha384', 'sha512'] as const;

const SUBTLE: Record<string, string> = { sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };

/** MD5 (RFC 1321): não existe no `crypto.subtle`, mas APIs legadas ainda usam. */
function md5(input: Uint8Array): Uint8Array {
    const s = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    const k = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
    const length = (((input.length + 8) >>> 6) + 1) * 64;
    const data = new Uint8Array(length);

    data.set(input);
    data[input.length] = 0x80;
    new DataView(data.buffer).setUint32(length - 8, (input.length * 8) >>> 0, true);
    new DataView(data.buffer).setUint32(length - 4, Math.floor(input.length / 2 ** 29), true);

    const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    const view = new DataView(data.buffer);

    for (let offset = 0; offset < length; offset += 64) {
        let [a, b, c, d] = state as [number, number, number, number];

        for (let i = 0; i < 64; i++) {
            const round = i >> 4;
            const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
            const g = round === 0 ? i : round === 1 ? (5 * i + 1) % 16 : round === 2 ? (3 * i + 5) % 16 : (7 * i) % 16;
            const sum = (a + f + k[i]! + view.getUint32(offset + g * 4, true)) >>> 0;
            const shift = s[round * 4 + (i % 4)]!;

            [a, b, c, d] = [d, (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0, b, c];
        }

        state[0] = (state[0]! + a) >>> 0;
        state[1] = (state[1]! + b) >>> 0;
        state[2] = (state[2]! + c) >>> 0;
        state[3] = (state[3]! + d) >>> 0;
    }

    const out = new Uint8Array(16);

    state.forEach((word, i) => new DataView(out.buffer).setUint32(i * 4, word, true));

    return out;
}

const bytes = (value: unknown): Uint8Array<ArrayBuffer> => new TextEncoder().encode(str(value));
const encode = (digest: Uint8Array, encoding: unknown): string => (str(encoding || 'hex') === 'base64' ? base64Encode(digest) : toHex(digest));

const subtleName = (algorithm: unknown): string => {
    const name = SUBTLE[str(algorithm).toLowerCase()];

    if (!name) {
        throw new TemplateError(`Unsupported algorithm "${str(algorithm)}" (use ${HASH_ALGORITHMS.join(', ')})`);
    }

    return name;
};

export async function digest(algorithm: unknown, value: unknown): Promise<Uint8Array> {
    return str(algorithm).toLowerCase() === 'md5' ? md5(bytes(value)) : new Uint8Array(await crypto.subtle.digest(subtleName(algorithm), bytes(value)));
}

export async function hmacBytes(algorithm: unknown, key: unknown, value: unknown): Promise<Uint8Array> {
    const cryptoKey = await crypto.subtle.importKey('raw', bytes(key), { name: 'HMAC', hash: subtleName(algorithm) }, false, ['sign']);

    return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, bytes(value)));
}

const algorithmArg = arg('algorithm', { values: HASH_ALGORITHMS });
const encodingArg = opt('encoding', { values: ['hex', 'base64'] });

export const CRYPTO_FUNCTIONS: CatalogNode[] = [
    fn('hash', 'string', 'md5 / sha1 / sha256 / sha384 / sha512', [algorithmArg, arg('value'), encodingArg], async (algorithm: unknown, value: unknown, encoding?: unknown) => encode(await digest(algorithm, value), encoding), {
        example: "{{ otto.hash('sha256', 'text') }}"
    }),
    fn(
        'hmac',
        'string',
        'HMAC signature',
        [arg('algorithm', { values: HASH_ALGORITHMS.slice(1) }), arg('key'), arg('value'), encodingArg],
        async (algorithm: unknown, key: unknown, value: unknown, encoding?: unknown) => encode(await hmacBytes(algorithm, key, value), encoding),
        {
            example: "{{ otto.hmac('sha256', $.secret, otto.request.text()) }}"
        }
    )
];
