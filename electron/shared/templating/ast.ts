export type Access = { kind: 'member'; name: string } | { kind: 'index'; key: Expr } | { kind: 'call'; args: Expr[] };

export type VariableScope = 'env' | 'collection';

export type Expr =
    | { kind: 'literal'; value: string | number | boolean | null }
    | { kind: 'object'; entries: Array<[string, Expr]> }
    | { kind: 'array'; items: Expr[] }
    /** `$.nome`, `$['nome']`, `$env.nome`… */
    | { kind: 'var'; scope: VariableScope | null; name: string; access: Access[] }
    | { kind: 'otto'; access: Access[] }
    /** Forma antiga `{{nome}}` (alias de `{{$.nome}}`). */
    | { kind: 'legacy'; name: string };

/** `otto.request('ref')…`: outra requisição da coleção (e não a atual, `otto.request.x`). */
export const isRequestRef = (expr: Expr): boolean => expr.kind === 'otto' && expr.access[0]?.kind === 'member' && expr.access[0].name === 'request' && expr.access[1]?.kind === 'call';

const literalText = (expr: Expr | undefined): string => (expr?.kind === 'literal' ? String(expr.value) : '…');

/** Rótulo curto do chip: `base_url`, `Login › get $.token`, `uuid()`, `hmac sha256`. */
export function describe(expr: Expr, requestName: (ref: string) => string | null = () => null): string {
    if (expr.kind === 'var') {
        return expr.name + (expr.access.length ? '…' : '');
    }

    if (expr.kind === 'legacy') {
        return expr.name;
    }

    if (expr.kind !== 'otto') {
        return literalText(expr);
    }

    const names = expr.access.flatMap((access) => (access.kind === 'member' ? [access.name] : []));
    const calls = expr.access.filter((access): access is Extract<Access, { kind: 'call' }> => access.kind === 'call');
    const lastCall = calls.at(-1);
    const lastName = names.at(-1) ?? 'otto';
    const lastArg = lastCall && lastCall.args[0] ? ` ${literalText(lastCall.args[0])}` : '';

    if (isRequestRef(expr)) {
        const ref = literalText(calls[0]?.args[0]);
        const title = requestName(ref) ?? ref;
        const rest = names.slice(1).filter((name) => name !== 'response' && name !== 'body');

        return [title, rest.join(' ') + (calls.length > 1 ? lastArg : '')].filter(Boolean).join(' › ');
    }

    if (names[0] === 'request') {
        return [
            'Request',
            names
                .slice(1)
                .filter((name) => name !== 'body')
                .join(' ') + (lastCall ? lastArg : '')
        ]
            .filter(Boolean)
            .join(' › ');
    }

    if (names.length === 1 && lastCall?.args.length && lastCall.args[0]?.kind === 'literal' && ['hash', 'hmac'].includes(lastName)) {
        return `${lastName}${lastArg}`;
    }

    return `${names.join('.')}${expr.access.at(-1)?.kind === 'call' ? '()' : ''}`;
}
