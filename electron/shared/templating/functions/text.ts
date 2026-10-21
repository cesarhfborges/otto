import { arg, fn, ns, opt, str, type CatalogNode } from '../node';

const text = (name: string, description: string, transform: (value: string) => unknown): CatalogNode => fn(name, 'string', description, [arg('value')], (value: unknown) => transform(str(value)));

export const STRING_FUNCTIONS: CatalogNode[] = [
    ns('string', 'Text transformations', [
        text('upper', 'UPPER CASE', (value) => value.toUpperCase()),
        text('lower', 'lower case', (value) => value.toLowerCase()),
        text('trim', 'Remove surrounding spaces', (value) => value.trim()),
        text('capitalize', 'First letter upper case', (value) => value.charAt(0).toUpperCase() + value.slice(1)),
        text('slug', 'URL slug (ação rápida → acao-rapida)', (value) =>
            value
                .normalize('NFD')
                .replace(/[̀-ͯ]/g, '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '')
        ),
        fn('length', 'number', 'Number of characters', [arg('value')], (value: unknown) => str(value).length),
        fn('replace', 'string', 'Replace all occurrences', [arg('value'), arg('from'), arg('to')], (value: unknown, from: unknown, to: unknown) => str(value).split(str(from)).join(str(to))),
        fn('regex', 'string', 'Extract with a regular expression (group: default 0)', [arg('value'), arg('pattern'), opt('group')], (value: unknown, pattern: unknown, group: unknown = 0) => new RegExp(str(pattern)).exec(str(value))?.[Number(group)] ?? ''),
        fn('substring', 'string', 'Part of the text', [arg('value'), arg('start'), opt('end')], (value: unknown, start: unknown, end?: unknown) => str(value).substring(Number(start), end === undefined ? undefined : Number(end))),
        fn('padStart', 'string', 'Pad at the start', [arg('value'), arg('size'), opt('char')], (value: unknown, size: unknown, char: unknown = ' ') => str(value).padStart(Number(size), str(char))),
        fn('padEnd', 'string', 'Pad at the end', [arg('value'), arg('size'), opt('char')], (value: unknown, size: unknown, char: unknown = ' ') => str(value).padEnd(Number(size), str(char))),
        fn('split', 'string', 'Split and take one part', [arg('value'), arg('separator'), arg('index')], (value: unknown, separator: unknown, index: unknown) => str(value).split(str(separator)).at(Number(index)) ?? ''),
        fn('join', 'string', 'Join an array', [arg('array'), opt('separator')], (items: unknown, separator: unknown = ',') => (Array.isArray(items) ? items.map(str).join(str(separator)) : str(items))),
        fn('repeat', 'string', 'Repeat n times', [arg('value'), arg('count')], (value: unknown, count: unknown) => str(value).repeat(Math.max(0, Number(count)))),
        fn('concat', 'string', 'Join values', [arg('values…')], (...values: unknown[]) => values.map(str).join(''))
    ])
];
