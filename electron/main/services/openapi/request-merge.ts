import type { KeyValue, MultipartField, RequestBody, RequestDefinition } from '../../../shared/models';

const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Lista do spec com os valores locais: itens com o mesmo nome mantêm valor, estado e
 * descrição da coleção; itens criados na coleção (fora do último spec) continuam no fim.
 */
function mergeList<T extends KeyValue | MultipartField>(local: readonly T[], base: readonly T[] | undefined, incoming: readonly T[], ignoreCase: boolean): T[] {
    const name = (item: T): string => (ignoreCase ? item.key.toLowerCase() : item.key);
    const localByName = new Map(local.map((item) => [name(item), item]));
    const known = new Set([...(base ?? []), ...incoming].map(name));

    return [...incoming.map((item) => localByName.get(name(item)) ?? item), ...local.filter((item) => !known.has(name(item)))];
}

function mergeBody(local: RequestBody, base: RequestBody | undefined, incoming: RequestBody): RequestBody {
    if (local.type !== incoming.type) {
        return base && !equal(local, base) ? local : incoming;
    }

    if ((local.type === 'form-urlencoded' || local.type === 'multipart-form') && local.type === incoming.type) {
        const baseFields = base?.type === local.type ? base.fields : undefined;

        return { ...incoming, fields: mergeList<KeyValue | MultipartField>(local.fields, baseFields, incoming.fields, false) } as RequestBody;
    }

    // Mesmo tipo: o conteúdo local (payload de teste) vale mais que o exemplo gerado do schema.
    return local;
}

/**
 * Requisição gravada ao aplicar uma atualização do spec sobre a da coleção.
 * Campos que o spec não gera (id, ordem, scripts, exemplos) sempre ficam. Com `preserveValues`,
 * a mesclagem é campo a campo: o que foi editado na coleção desde o último sync (`base`)
 * fica; params, headers e campos de formulário mantêm os valores locais; auth do mesmo tipo
 * mantém credenciais. Sem `preserveValues`, o resto vem do spec.
 */
export function mergeRequest(local: RequestDefinition, base: RequestDefinition | undefined, incoming: RequestDefinition, preserveValues: boolean): RequestDefinition {
    const kept = { id: local.id, seq: local.seq, scripts: local.scripts, examples: local.examples };

    if (!preserveValues) {
        return { ...incoming, ...kept };
    }

    const pick = <K extends 'name' | 'method' | 'url' | 'docs'>(field: K): RequestDefinition[K] => (base && !equal(local[field], base[field]) ? local[field] : incoming[field]);

    return {
        ...incoming,
        ...kept,
        name: pick('name'),
        method: pick('method'),
        url: pick('url'),
        docs: pick('docs'),
        params: mergeList(local.params, base?.params, incoming.params, false),
        headers: mergeList(local.headers, base?.headers, incoming.headers, true),
        auth: local.auth.type === incoming.auth.type || (base && !equal(local.auth, base.auth)) ? local.auth : incoming.auth,
        body: mergeBody(local.body, base?.body, incoming.body)
    };
}
