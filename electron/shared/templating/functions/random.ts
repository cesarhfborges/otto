import { TemplateError } from '../errors';
import { arg, fn, ns, opt, str, type CatalogNode } from '../node';
import { formatDate, toDate } from './date';

const FIRST = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Felipe', 'Gabriela', 'Hugo', 'Isabela', 'João', 'Larissa', 'Marcos', 'Natália', 'Otávio', 'Paula', 'Rafael', 'Sofia', 'Thiago', 'Emma', 'Liam', 'Olivia', 'Noah'];
const LAST = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Costa', 'Ferreira', 'Almeida', 'Ribeiro', 'Carvalho', 'Gomes', 'Smith', 'Johnson', 'Brown', 'Miller'];
const DOMAINS = ['example.com', 'example.org', 'mail.test', 'acme.dev'];
const CHARSETS: Record<string, string> = {
    alpha: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
    alnum: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    numeric: '0123456789',
    hex: '0123456789abcdef'
};

const int = (min: number, max: number): number => Math.floor(Math.random() * (Math.floor(max) - Math.ceil(min) + 1)) + Math.ceil(min);
const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)]!;
const digits = (count: number): number[] => Array.from({ length: count }, () => int(0, 9));
const ascii = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Dígito verificador (módulo 11) de CPF/CNPJ. */
const checkDigit = (numbers: number[], weights: number[]): number => {
    const rest = numbers.reduce((sum, digit, index) => sum + digit * weights[index]!, 0) % 11;

    return rest < 2 ? 0 : 11 - rest;
};

function cpf(formatted: unknown): string {
    const base = digits(9);
    const first = checkDigit(base, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const all = [...base, first, checkDigit([...base, first], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])].join('');

    return formatted ? all.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : all;
}

function cnpj(formatted: unknown): string {
    const base = [...digits(8), 0, 0, 0, 1];
    const first = checkDigit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const all = [...base, first, checkDigit([...base, first], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])].join('');

    return formatted ? all.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : all;
}

function randomString(size: unknown, charset: unknown = 'alnum'): string {
    const chars = CHARSETS[str(charset)] ?? str(charset);

    if (!chars) {
        throw new TemplateError('random.string: empty charset');
    }

    return Array.from({ length: Number(size) || 16 }, () => pick([...chars])).join('');
}

export const RANDOM_FUNCTIONS: CatalogNode[] = [
    ns('random', 'Random values and fake data', [
        fn('int', 'number', 'Integer between min and max', [opt('min'), opt('max')], (min = 0, max = 100) => int(Number(min), Number(max))),
        fn('float', 'number', 'Decimal between min and max', [opt('min'), opt('max'), opt('decimals')], (min = 0, max = 1, decimals = 2) => Number((Math.random() * (Number(max) - Number(min)) + Number(min)).toFixed(Number(decimals)))),
        fn('boolean', 'boolean', 'true or false', [], () => Math.random() < 0.5),
        fn('string', 'string', 'Random text (charset: alpha, alnum, numeric, hex or literal characters)', [opt('size'), opt('charset', { values: Object.keys(CHARSETS) })], randomString),
        fn('hex', 'string', 'Random hexadecimal', [opt('size')], (size = 16) => randomString(size, 'hex')),
        fn('pick', 'any', 'One of the given values', [arg('values…')], (...values: unknown[]) => (values.length ? pick(values) : '')),
        fn('firstName', 'string', 'Fake first name', [], () => pick(FIRST)),
        fn('lastName', 'string', 'Fake last name', [], () => pick(LAST)),
        fn('name', 'string', 'Fake full name', [], () => `${pick(FIRST)} ${pick(LAST)}`),
        fn('username', 'string', 'Fake username', [], () => `${ascii(pick(FIRST))}${ascii(pick(LAST))}${int(1, 99)}`),
        fn('email', 'string', 'Fake e-mail', [], () => `${ascii(pick(FIRST))}.${ascii(pick(LAST))}${int(1, 99)}@${pick(DOMAINS)}`),
        fn('phone', 'string', 'Fake Brazilian phone number', [], () => `(${int(11, 99)}) 9${digits(4).join('')}-${digits(4).join('')}`),
        fn('cpf', 'string', 'Valid CPF (check digits)', [opt('formatted', { values: ['true', 'false'] })], cpf),
        fn('cnpj', 'string', 'Valid CNPJ (check digits)', [opt('formatted', { values: ['true', 'false'] })], cnpj),
        fn('date', 'string', 'Date between start and end (default: last year to now)', [opt('start'), opt('end'), opt('format')], (start?: unknown, end?: unknown, format?: string) => {
            const from = start ? toDate(start).getTime() : Date.now() - 365 * 864e5;
            const to = end ? toDate(end).getTime() : Date.now();

            return formatDate(new Date(int(from, to)), format ? str(format) : 'iso');
        })
    ])
];
