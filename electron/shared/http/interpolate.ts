import type { KeyValue, RequestAuth, RequestBody, RequestDefinition } from '../models';
import { variableRefs } from '../templating/analyze';
import { createTemplateEngine, type TemplateEngine, type TemplateEngineOptions } from '../templating/engine';
import { requestSnapshot, type MessageSnapshot, type ReadGuard } from '../templating/message';
import { tryParse } from '../templating/parse';
import { tokenize } from '../templating/tokenize';

export interface InterpolationResult {
    definition: RequestDefinition;
    /** Variáveis usadas na requisição que não existem em nenhum escopo (sem repetição). */
    unresolved: string[];
    /** Demais problemas (sintaxe, comandos, requisições referenciadas…). */
    errors: string[];
}

type Render = (value: string, guard?: ReadGuard) => Promise<string>;

/** Percorre os campos interpoláveis (URL → params → headers → auth → corpo), na ordem. Itens desabilitados ficam como estão. */
async function mapFields(definition: RequestDefinition, render: Render): Promise<RequestDefinition> {
    const pairs = async <T extends KeyValue>(items: T[], header = false): Promise<T[]> => {
        const out: T[] = [];

        for (const item of items) {
            out.push(item.enabled ? { ...item, key: await render(item.key), value: await render(item.value, header ? { header: item.key.trim() } : {}) } : item);
        }

        return out;
    };

    const url = await render(definition.url);
    const params = await pairs(definition.params);
    const headers = await pairs(definition.headers, true);

    const auth = await (async (): Promise<RequestAuth> => {
        const current = definition.auth;

        switch (current.type) {
            case 'bearer':
                return { ...current, token: await render(current.token, { header: 'Authorization' }), ...(current.prefix && { prefix: await render(current.prefix) }) };
            case 'apikey':
                return { ...current, key: await render(current.key), value: await render(current.value, current.in === 'header' ? { header: current.key } : {}) };
            default: {
                // Demais tipos: todo campo de texto aceita `{{variáveis}}` (enums não têm tags e saem iguais).
                const rendered: Record<string, unknown> = { ...current };

                for (const [key, value] of Object.entries(current)) {
                    if (key !== 'type' && typeof value === 'string') {
                        rendered[key] = await render(value);
                    }
                }

                return rendered as RequestAuth;
            }
        }
    })();

    const body = await (async (): Promise<RequestBody> => {
        const current = definition.body;

        switch (current.type) {
            case 'json':
            case 'text':
            case 'xml':
                return { ...current, content: await render(current.content, { body: true }) };
            case 'form-urlencoded':
                return { ...current, fields: await pairs(current.fields) };
            case 'multipart-form':
                return { ...current, fields: await pairs(current.fields) };
            case 'binary':
                return { ...current, file: await render(current.file) };
            default:
                return current;
        }
    })();

    return { ...definition, url, params, headers, auth, body };
}

/**
 * Interpola URL, params, headers, autenticação e corpo (inclusive caminhos de arquivo)
 * com o motor de templates. `otto.request` lê a requisição já interpolada (sem as
 * leituras de `otto.request`, que não se encadeiam).
 */
export async function interpolateRequest(definition: RequestDefinition, options: Omit<TemplateEngineOptions, 'currentRequest'>): Promise<InterpolationResult> {
    let snapshot: Promise<MessageSnapshot> | null = null;
    const currentRequest = (): Promise<MessageSnapshot> =>
        (snapshot ??= (async () => {
            const plain = createTemplateEngine(options);

            return requestSnapshot(await mapFields(definition, async (value) => (await plain.render(value)).text));
        })());

    const engine: TemplateEngine = createTemplateEngine({ ...options, currentRequest });
    const unresolved = new Set<string>();
    const errors = new Set<string>();
    const resolved = await mapFields(definition, async (value, guard) => {
        const result = await engine.render(value, guard);

        result.unresolved.forEach((name) => unresolved.add(name));
        result.errors.forEach((error) => errors.add(error));

        return result.text;
    });

    return { definition: resolved, unresolved: [...unresolved], errors: [...errors] };
}

/** Textos interpoláveis da requisição (itens habilitados). */
function fieldTexts({ url, params, headers, auth, body }: RequestDefinition): string[] {
    const pairs = (items: KeyValue[]): string[] => items.filter((item) => item.enabled).flatMap((item) => [item.key, item.value]);
    const { type: _auth, ...authFields } = auth;
    const bodyTexts = body.type === 'form-urlencoded' || body.type === 'multipart-form' ? pairs(body.fields) : body.type === 'none' ? [] : [body.type === 'binary' ? body.file : body.content];

    void _auth;

    return [url, ...pairs(params), ...pairs(headers), ...Object.values(authFields).map(String), ...bodyTexts];
}

/** Nomes de variáveis usados na requisição (sem avaliar nada). */
export function templateVariables(definition: RequestDefinition): string[] {
    const names = new Set<string>();

    for (const text of fieldTexts(definition)) {
        for (const segment of tokenize(text)) {
            const parsed = segment.type === 'tag' ? tryParse(segment.inner) : null;

            parsed?.expr && variableRefs(parsed.expr).forEach((name) => names.add(name));
        }
    }

    return [...names];
}
