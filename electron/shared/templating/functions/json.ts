import { TemplateError, UnresolvedError } from '../errors';
import { jsonPathAll } from '../jsonpath';
import { arg, fn, ns, opt, str, type CatalogNode } from '../node';

const parsed = (value: unknown): unknown => {
    if (typeof value !== 'string') {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch {
        throw new TemplateError('Value is not valid JSON');
    }
};

export const JSON_FUNCTIONS: CatalogNode[] = [
    ns('json', 'JSON helpers', [
        fn('get', 'any', 'JSONPath over any value', [arg('value'), arg('path')], (value: unknown, path: unknown) => {
            const [first] = jsonPathAll(parsed(value), str(path));

            if (first === undefined) {
                throw new UnresolvedError(`"${str(path)}" not found`);
            }

            return first;
        }),
        fn('stringify', 'string', 'Serialize (optional indentation)', [arg('value'), opt('indent')], (value: unknown, indent?: unknown) => JSON.stringify(value, null, indent === undefined ? undefined : Number(indent))),
        fn('parse', 'any', 'Text → object (to chain)', [arg('text')], parsed),
        fn('escape', 'string', 'Escape to put inside a JSON string', [arg('value')], (value: unknown) => JSON.stringify(str(value)).slice(1, -1), { example: '"bio": "{{ otto.json.escape($.bio) }}"' })
    ])
];
