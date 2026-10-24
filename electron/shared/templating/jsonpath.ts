import { TemplateError } from './errors';

/**
 * Subconjunto de JSONPath: `$`, `.campo`, `['campo']`, `[n]`, `[-1]`, `[*]`, `.*`,
 * `..campo`, `[a,b]`, `[início:fim]`, `[?(@.campo)]` e `[?(@.campo == 'x')]`
 * (`==`, `!=`, `>`, `<`, `>=`, `<=`).
 */
type Step = { kind: 'key'; keys: Array<string | number>; recursive: boolean } | { kind: 'wildcard'; recursive: boolean } | { kind: 'slice'; start?: number; end?: number } | { kind: 'filter'; field: string[]; op?: string; value?: unknown };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function parseLiteral(text: string): unknown {
    const trimmed = text.trim();

    if (/^['"]/.test(trimmed)) {
        return trimmed.slice(1, -1);
    }

    return trimmed === 'true' ? true : trimmed === 'false' ? false : trimmed === 'null' ? null : Number(trimmed);
}

function compile(path: string): Step[] {
    if (!path.startsWith('$')) {
        throw new TemplateError(`JSONPath must start with "$": ${path}`);
    }

    const steps: Step[] = [];
    let i = 1;

    while (i < path.length) {
        const recursive = path.startsWith('..', i);

        if (path[i] === '.') {
            i += recursive ? 2 : 1;

            if (path[i] === '*') {
                steps.push({ kind: 'wildcard', recursive });
                i++;
                continue;
            }

            if (path[i] === '[') {
                continue;
            }

            const name = /^[^.[\]]+/.exec(path.slice(i))?.[0];

            if (!name) {
                throw new TemplateError(`Invalid JSONPath: ${path}`);
            }

            steps.push({ kind: 'key', keys: [name], recursive });
            i += name.length;
        } else if (path[i] === '[') {
            const close = path.indexOf(']', path[i + 1] === '?' ? path.indexOf(')', i) : i);

            if (close < 0) {
                throw new TemplateError(`Invalid JSONPath: ${path}`);
            }

            const inside = path.slice(i + 1, close).trim();
            const afterRecursive = path.slice(i - 2, i) === '..';

            i = close + 1;

            if (inside === '*') {
                steps.push({ kind: 'wildcard', recursive: afterRecursive });
            } else if (inside.startsWith('?')) {
                const match = /^\?\(\s*@((?:\.[\w-]+)*)\s*(?:(==|!=|>=|<=|>|<)\s*(.+?))?\s*\)$/.exec(inside);

                if (!match) {
                    throw new TemplateError(`Unsupported JSONPath filter: ${inside}`);
                }

                steps.push({ kind: 'filter', field: match[1]!.split('.').filter(Boolean), ...(match[2] && { op: match[2], value: parseLiteral(match[3]!) }) });
            } else if (/^-?\d*:-?\d*$/.test(inside)) {
                const [start, end] = inside.split(':').map((part) => (part ? Number(part) : undefined));

                steps.push({ kind: 'slice', ...(start !== undefined && { start }), ...(end !== undefined && { end }) });
            } else {
                const keys = inside.split(',').map((part) => {
                    const key = part.trim();

                    return /^['"]/.test(key) ? key.slice(1, -1) : Number(key);
                });

                steps.push({ kind: 'key', keys, recursive: afterRecursive });
            }
        } else {
            throw new TemplateError(`Invalid JSONPath: ${path}`);
        }
    }

    return steps;
}

const descendants = (value: unknown): unknown[] => [value, ...(isObject(value) ? Object.values(value).flatMap(descendants) : [])];

function compare(left: unknown, op: string, right: unknown): boolean {
    switch (op) {
        case '==':
            return left === right;
        case '!=':
            return left !== right;
        case '>':
            return Number(left) > Number(right);
        case '<':
            return Number(left) < Number(right);
        case '>=':
            return Number(left) >= Number(right);
        default:
            return Number(left) <= Number(right);
    }
}

function apply(step: Step, value: unknown): unknown[] {
    const pool = 'recursive' in step && step.recursive ? descendants(value) : [value];

    return pool.flatMap((node): unknown[] => {
        switch (step.kind) {
            case 'wildcard':
                return isObject(node) ? Object.values(node) : [];
            case 'key':
                return step.keys.flatMap((key) => {
                    if (Array.isArray(node) && typeof key === 'number') {
                        const item = node.at(key);

                        return item === undefined ? [] : [item];
                    }

                    return isObject(node) && Object.hasOwn(node, String(key)) ? [node[String(key)]] : [];
                });
            case 'slice':
                return Array.isArray(node) ? node.slice(step.start, step.end) : [];
            case 'filter':
                return (Array.isArray(node) ? node : isObject(node) ? Object.values(node) : []).filter((item) => {
                    let current: unknown = item;

                    for (const field of step.field) {
                        current = isObject(current) ? current[field] : undefined;
                    }

                    return step.op ? compare(current, step.op, step.value) : current !== undefined && current !== null && current !== false;
                });
        }
    });
}

/** Todos os valores que casam com o caminho. */
export function jsonPathAll(value: unknown, path: string): unknown[] {
    return compile(path.trim()).reduce<unknown[]>((nodes, step) => nodes.flatMap((node) => apply(step, node)), [value]);
}

/** Caminhos das folhas e objetos de um JSON (para o autocomplete), com o valor de cada um. */
export function jsonPaths(value: unknown, limit = 200): Array<{ path: string; value: unknown }> {
    const found: Array<{ path: string; value: unknown }> = [];
    const walk = (node: unknown, path: string, depth: number): void => {
        if (found.length >= limit || depth > 6) {
            return;
        }

        if (path !== '$') {
            found.push({ path, value: node });
        }

        if (Array.isArray(node)) {
            node.slice(0, 3).forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
        } else if (isObject(node)) {
            for (const [key, item] of Object.entries(node)) {
                walk(item, /^[A-Za-z_]\w*$/.test(key) ? `${path}.${key}` : `${path}['${key}']`, depth + 1);
            }
        }
    };

    walk(value, '$', 0);

    return found;
}
