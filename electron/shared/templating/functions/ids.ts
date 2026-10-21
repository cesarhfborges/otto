import { fn, opt, type CatalogNode } from '../node';

const randomBytes = (size: number): Uint8Array => crypto.getRandomValues(new Uint8Array(size));
const NANOID = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function uuidV7(): string {
    const bytes = randomBytes(16);
    let time = Date.now();

    for (let i = 5; i >= 0; i--) {
        bytes[i] = time % 256;
        time = Math.floor(time / 256);
    }

    bytes[6] = (bytes[6]! & 0x0f) | 0x70;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function ulid(): string {
    let time = Date.now();
    let head = '';

    for (let i = 0; i < 10; i++) {
        head = CROCKFORD[time % 32]! + head;
        time = Math.floor(time / 32);
    }

    return head + Array.from(randomBytes(16), (byte) => CROCKFORD[byte % 32]).join('');
}

export const ID_FUNCTIONS: CatalogNode[] = [
    fn('uuid', 'string', 'Random UUID (v4, or v7 ordered by time)', [opt('version', { values: ['v4', 'v7'] })], (version?: string) => (version === 'v7' ? uuidV7() : crypto.randomUUID()), { example: '{{ otto.uuid() }}' }),
    fn('nanoid', 'string', 'Short URL-safe random id', [opt('size')], (size?: number) => Array.from(randomBytes(Number(size) || 21), (byte) => NANOID[byte & 63]).join('')),
    fn('ulid', 'string', 'Lexicographically sortable id', [], ulid)
];
