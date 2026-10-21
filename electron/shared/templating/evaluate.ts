import type { Access, Expr, VariableScope } from './ast';
import { TemplateError, UnresolvedError } from './errors';
import { LAZY_FUNCTIONS, RUNTIME_OBJECTS } from './runtime';

export interface EvalEnv {
    /** Valor (texto, já resolvido) da variável; lança `UnresolvedError` se não existir. */
    variable(name: string, scope: VariableScope | null): Promise<string>;
    otto: object;
}

const BLOCKED = new Set(['__proto__', 'constructor', 'prototype', 'call', 'apply', 'bind']);

/** Leitura segura: só propriedades próprias (sem protótipos, sem `eval`). */
async function read(target: unknown, key: string | number, label: string): Promise<unknown> {
    const name = String(key);

    if (BLOCKED.has(name)) {
        throw new TemplateError(`"${name}" cannot be accessed`);
    }

    if ((typeof target === 'string' || Array.isArray(target)) && name === 'length') {
        return target.length;
    }

    if (Array.isArray(target) && typeof key === 'number') {
        const item = target.at(key);

        if (item === undefined) {
            throw new UnresolvedError(`${label}[${key}] not found`);
        }

        return item;
    }

    if ((typeof target === 'object' || typeof target === 'function') && target !== null && Object.hasOwn(target, name)) {
        return await (target as Record<string, unknown>)[name];
    }

    if (typeof target === 'object' && target !== null && RUNTIME_OBJECTS.has(target)) {
        throw new TemplateError(`Unknown member "${name}" of ${label}`);
    }

    throw new UnresolvedError(`"${label}.${name}" not found`);
}

async function applyAccess(start: unknown, chain: readonly Access[], env: EvalEnv, label: string): Promise<unknown> {
    let current = start;
    let parent: unknown;

    for (const access of chain) {
        if (access.kind === 'call') {
            if (typeof current !== 'function') {
                throw new TemplateError(`${label} is not a function`);
            }

            const fn = current as (...args: unknown[]) => unknown;
            const args: unknown[] = [];

            for (const item of access.args) {
                args.push(LAZY_FUNCTIONS.has(fn) ? () => evaluate(item, env) : await evaluate(item, env));
            }

            current = await fn.apply(parent, args);
            parent = undefined;
            label += '()';
        } else {
            const key = access.kind === 'member' ? access.name : ((await evaluate(access.key, env)) as string | number);

            parent = current;
            current = await read(current, key, label);
            label += access.kind === 'member' ? `.${key}` : `[${JSON.stringify(key)}]`;
        }
    }

    return current;
}

/** Valor JSON de variável (`{{$.user.id}}`) quando há acesso a propriedades. */
const jsonish = (value: string): unknown => {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
};

export async function evaluate(expr: Expr, env: EvalEnv): Promise<unknown> {
    switch (expr.kind) {
        case 'literal':
            return expr.value;
        case 'array': {
            const items: unknown[] = [];

            for (const item of expr.items) {
                items.push(await evaluate(item, env));
            }

            return items;
        }
        case 'object': {
            const object: Record<string, unknown> = {};

            for (const [key, value] of expr.entries) {
                object[key] = await evaluate(value, env);
            }

            return object;
        }
        case 'legacy':
            return env.variable(expr.name, null);
        case 'var': {
            const value = await env.variable(expr.name, expr.scope);

            return expr.access.length ? applyAccess(jsonish(value), expr.access, env, `$.${expr.name}`) : value;
        }
        case 'otto':
            return applyAccess(env.otto, expr.access, env, 'otto');
    }
}
