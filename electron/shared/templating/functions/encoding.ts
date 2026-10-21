import { TemplateError } from '../errors';
import { arg, fn, ns, str, type CatalogNode } from '../node';

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

export const base64Encode = (bytes: Uint8Array): string => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));

export function base64Decode(value: string): Uint8Array {
    try {
        return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
    } catch {
        throw new TemplateError('Invalid Base64 value');
    }
}

export const base64Url = (bytes: Uint8Array): string => base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const toHex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const HTML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Função com sub-funções (`otto.base64('x')` e `otto.base64.decode('eA==')`). */
const callable = (name: string, returns: string, description: string, encode: (value: unknown) => unknown, decode: (value: unknown) => unknown): CatalogNode =>
    fn(name, returns, description, [arg('value')], encode, { members: [fn('decode', 'string', `Decode ${name}`, [arg('value')], decode)] });

export const ENCODING_FUNCTIONS: CatalogNode[] = [
    callable('base64', 'string', 'Base64 encode (UTF-8)', (value) => base64Encode(bytesOf(str(value))), (value) => textOf(base64Decode(str(value)))),
    callable('base64url', 'string', 'URL-safe Base64, without padding', (value) => base64Url(bytesOf(str(value))), (value) => textOf(base64Decode(str(value)))),
    callable('hex', 'string', 'Hexadecimal encode', (value) => toHex(bytesOf(str(value))), (value) => textOf(Uint8Array.from(str(value).match(/../g) ?? [], (byte) => parseInt(byte, 16)))),
    ns('url', 'URL encoding', [
        fn('encode', 'string', 'encodeURIComponent', [arg('value')], (value: unknown) => encodeURIComponent(str(value))),
        fn('decode', 'string', 'decodeURIComponent', [arg('value')], (value: unknown) => decodeURIComponent(str(value))),
        fn('query', 'string', "Object → query string ({ a: 1 } → a=1)", [arg('object')], (value: unknown) => new URLSearchParams(Object.entries((value ?? {}) as Record<string, unknown>).map(([key, item]) => [key, str(item)])).toString())
    ]),
    ns('html', 'HTML/XML entities', [
        fn('escape', 'string', 'Escape & < > " \'', [arg('value')], (value: unknown) => str(value).replace(/[&<>"']/g, (char) => HTML_ENTITIES[char]!)),
        fn('unescape', 'string', 'Unescape HTML entities', [arg('value')], (value: unknown) =>
            str(value).replace(/&(amp|lt|gt|quot|#39|#x?[\da-f]+);/gi, (entity, code: string) => {
                const named = Object.entries(HTML_ENTITIES).find(([, text]) => text === entity.toLowerCase());

                return named ? named[0] : String.fromCodePoint(code.toLowerCase().startsWith('#x') ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10));
            })
        )
    ])
];
