import type { KeyValue } from '../models/common';
import type { RequestAuth, RequestBody, RequestDefinition } from '../models/request';

/** `{{nome}}`, com espaços opcionais (`{{ nome }}`). */
export const VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Variáveis aninhadas (`{{url}}` = `{{host}}/v1`) são resolvidas até esta profundidade. */
const MAX_DEPTH = 5;

export interface InterpolationResult {
    definition: RequestDefinition;
    /** Nomes usados na requisição que não existem nas variáveis (sem repetição). */
    unresolved: string[];
}

/** Variáveis habilitadas de um ambiente, com as referências entre elas já resolvidas. */
export function variablesFrom(items: readonly KeyValue[]): Map<string, string> {
    const raw = new Map(items.filter((item) => item.enabled && item.key.trim()).map((item) => [item.key.trim(), item.value]));
    const resolved = new Map<string, string>();

    for (const [key, value] of raw) {
        let current = value;

        for (let depth = 0; depth < MAX_DEPTH && VARIABLE_PATTERN.test(current); depth++) {
            VARIABLE_PATTERN.lastIndex = 0;
            current = current.replace(VARIABLE_PATTERN, (match, name: string) => (name === key ? match : (raw.get(name) ?? match)));
        }

        VARIABLE_PATTERN.lastIndex = 0;
        resolved.set(key, current);
    }

    return resolved;
}

/**
 * Substitui `{{variáveis}}` em URL, params, headers, autenticação e corpo
 * (inclusive caminhos de arquivo). Itens desabilitados ficam como estão.
 */
export function interpolateRequest(definition: RequestDefinition, variables: ReadonlyMap<string, string>): InterpolationResult {
    const unresolved = new Set<string>();
    const text = (value: string): string =>
        value.replace(VARIABLE_PATTERN, (match, name: string) => {
            const replacement = variables.get(name);

            if (replacement === undefined) {
                unresolved.add(name);

                return match;
            }

            return replacement;
        });
    const pairs = <T extends KeyValue>(items: T[]): T[] => items.map((item) => (item.enabled ? { ...item, key: text(item.key), value: text(item.value) } : item));

    const auth = ((): RequestAuth => {
        const current = definition.auth;

        switch (current.type) {
            case 'bearer':
                return { ...current, token: text(current.token), ...(current.prefix && { prefix: text(current.prefix) }) };
            case 'basic':
            case 'wsse':
                return { ...current, username: text(current.username), password: text(current.password) };
            case 'apikey':
                return { ...current, key: text(current.key), value: text(current.value) };
            default:
                return current;
        }
    })();

    const body = ((): RequestBody => {
        const current = definition.body;

        switch (current.type) {
            case 'json':
            case 'text':
            case 'xml':
                return { ...current, content: text(current.content) };
            case 'form-urlencoded':
                return { ...current, fields: pairs(current.fields) };
            case 'multipart-form':
                return { ...current, fields: pairs(current.fields) };
            case 'binary':
                return { ...current, file: text(current.file) };
            default:
                return current;
        }
    })();

    return {
        definition: { ...definition, url: text(definition.url), params: pairs(definition.params), headers: pairs(definition.headers), auth, body },
        unresolved: [...unresolved]
    };
}
