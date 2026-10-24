import type { Access, Expr } from './ast';
import { describe, isRequestRef } from './ast';
import { availableIn, membersAfter, OTTO_CATALOG } from './catalog';
import { isDynamic, type CatalogNode, type Where } from './node';
import { tryParse } from './parse';
import type { VariableEntry, VariableScopes } from './scopes';

export type TagKind = 'variable' | 'secret' | 'command' | 'request';

export interface ValidationEnv {
    scopes: VariableScopes;
    /** Nome da requisição pelo `id` (ou caminho), `null` se não existe. */
    requestName(ref: string): string | null;
    where?: Where;
}

export interface TagInfo {
    expr: Expr | null;
    kind: TagKind;
    label: string;
    /** Motivo do estado incorreto (chip danger); `null` = correto. */
    error: string | null;
    /** Variável (quando a tag é uma referência simples). */
    variable?: VariableEntry;
}

/** Nomes de variáveis usados numa expressão (inclusive nos argumentos). */
export function variableRefs(expr: Expr): string[] {
    const fromAccess = (chain: readonly Access[]): string[] => chain.flatMap((access) => (access.kind === 'call' ? access.args.flatMap(variableRefs) : access.kind === 'index' ? variableRefs(access.key) : []));

    switch (expr.kind) {
        case 'legacy':
            return [expr.name];
        case 'var':
            return [expr.name, ...fromAccess(expr.access)];
        case 'otto':
            return fromAccess(expr.access);
        case 'array':
            return expr.items.flatMap(variableRefs);
        case 'object':
            return expr.entries.flatMap(([, value]) => variableRefs(value));
        default:
            return [];
    }
}

const requiredArgs = (node: CatalogNode): number => (node.args ?? []).filter((arg) => !arg.optional && !arg.name.endsWith('…')).length;

/** Percorre `otto.…` pelo catálogo: membro inexistente, chamada errada, argumentos faltando, requisição inexistente. */
function checkOtto(chain: readonly Access[], env: ValidationEnv): string | null {
    let node: CatalogNode = OTTO_CATALOG;
    let called = false;
    let dynamic = false;
    let path = 'otto';

    for (const access of chain) {
        if (access.kind === 'call') {
            for (const item of access.args) {
                const error = checkExpr(item, env);

                if (error) {
                    return error;
                }
            }
        }

        if (dynamic) {
            continue;
        }

        if (access.kind === 'member') {
            const next = membersAfter(node, called).find((member) => member.name === access.name);

            if (!next) {
                return `Unknown member "${access.name}" of ${path}`;
            }

            if (!availableIn(next, env.where ?? 'T')) {
                return `${path}.${access.name} is only available in scripts`;
            }

            node = next;
            called = false;
            path += `.${access.name}`;
            dynamic = next.kind === 'property' && isDynamic(next.returns);
        } else if (access.kind === 'index') {
            dynamic = true;
        } else {
            if (node.kind !== 'function' || called) {
                return `${path} is not a function`;
            }

            if (access.args.length < requiredArgs(node)) {
                return `${path}() expects ${requiredArgs(node)} argument(s)`;
            }

            const ref = access.args[0];

            if (node.args?.[0]?.source === 'requests' && ref?.kind === 'literal' && env.requestName(String(ref.value)) === null) {
                return `Request "${String(ref.value)}" not found in this collection`;
            }

            called = true;
            path += '()';
            dynamic = !node.result && isDynamic(node.returns);
        }
    }

    if (!dynamic && !called && (node.kind === 'namespace' || node.kind === 'function')) {
        return node.kind === 'function' ? `${path} is a function: call it with ()` : `${path} is a namespace: choose one of its members`;
    }

    return null;
}

function checkExpr(expr: Expr, env: ValidationEnv): string | null {
    switch (expr.kind) {
        case 'legacy':
        case 'var':
            if (!env.scopes.lookup(expr.name, expr.kind === 'var' ? expr.scope : null)) {
                return `Variable "${expr.name}" is not defined (${env.scopes.describe()})`;
            }

            return null;
        case 'otto':
            return checkOtto(expr.access, env);
        case 'array':
            return expr.items.map((item) => checkExpr(item, env)).find(Boolean) ?? null;
        case 'object':
            return expr.entries.map(([, value]) => checkExpr(value, env)).find(Boolean) ?? null;
        default:
            return null;
    }
}

/** Estado do chip (síncrono, sem avaliar nada): tipo, rótulo e erro. */
export function inspectTag(inner: string, env: ValidationEnv): TagInfo {
    const parsed = tryParse(inner);

    if (!parsed.expr) {
        return { expr: null, kind: 'command', label: inner.trim() || '…', error: `Syntax error: ${parsed.error}` };
    }

    const expr = parsed.expr;
    const label = describe(expr, env.requestName);
    const error = checkExpr(expr, env);

    if (expr.kind === 'var' || expr.kind === 'legacy') {
        const variable = env.scopes.lookup(expr.name, expr.kind === 'var' ? expr.scope : null);

        return { expr, kind: variable?.secret ? 'secret' : 'variable', label, error, ...(variable && { variable }) };
    }

    return { expr, kind: isRequestRef(expr) ? 'request' : 'command', label, error };
}
