import type { HttpMethod, RequestDefinition, ResponseExample } from '../../../shared/models';

/** Segmento do caminho: literal ou parâmetro (`:id`, `{id}`, `{{$.id}}`). */
type Segment = { literal: string } | { param: string };

export interface MockRoute {
    method: HttpMethod;
    /** Caminho como exibido (`/users/:id`). */
    pattern: string;
    segments: Segment[];
    requestPath: string;
    examples: ResponseExample[];
}

export interface MockMatch {
    route: MockRoute;
    params: Record<string, string>;
}

/** Nome do parâmetro de um segmento com template: último identificador (`{{$.userId}}` → `userId`). */
const templateName = (segment: string): string => /([A-Za-z_][\w-]*)\s*\}\}[^{}]*$/.exec(segment)?.[1] ?? 'param';

/**
 * Caminho da URL da requisição, sem esquema/host nem o prefixo com variáveis
 * (`{{$.baseUrl}}/users` → `/users`) e sem a query string.
 */
export function mockPath(url: string): string {
    let rest = url.trim().split(/[?#]/)[0] ?? '';

    // Prefixo com template (base URL) até a primeira barra fora de `{{ }}`.
    if (rest.startsWith('{{')) {
        const end = rest.indexOf('}}');

        rest = end >= 0 ? rest.slice(end + 2) : '';
    }

    rest = rest.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]*/i, '');

    if (!rest.startsWith('/')) {
        // `api.example.com/users` (sem esquema) ou só host: descarta o host.
        const slash = rest.indexOf('/');

        rest = slash >= 0 && !rest.startsWith('{{') ? rest.slice(slash) : `/${rest}`;
    }

    return rest.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1') || '/';
}

function toSegment(segment: string): Segment {
    if (segment.includes('{{')) {
        return { param: templateName(segment) };
    }

    const colon = /^:(\w+)$/.exec(segment) ?? /^\{(\w+)\}$/.exec(segment);

    return colon ? { param: colon[1]! } : { literal: decodeURIComponent(segment) };
}

/** Rotas das requisições que têm exemplos. */
export function buildRoutes(requests: ReadonlyArray<{ path: string; request: RequestDefinition }>): MockRoute[] {
    return requests
        .filter(({ request }) => request.examples?.length)
        .map(({ path, request }) => {
            const segments = mockPath(request.url).split('/').filter(Boolean).map(toSegment);

            return {
                method: request.method,
                pattern: `/${segments.map((segment) => ('literal' in segment ? segment.literal : `:${segment.param}`)).join('/')}`,
                segments,
                requestPath: path,
                examples: request.examples ?? []
            };
        });
}

/**
 * Rota mais específica (mais segmentos literais) para o método e caminho.
 * `HEAD` também casa com rotas `GET`.
 */
export function matchRoute(routes: readonly MockRoute[], method: string, pathname: string): MockMatch | null {
    const parts = pathname
        .split('/')
        .filter(Boolean)
        .map((part) => {
            try {
                return decodeURIComponent(part);
            } catch {
                return part;
            }
        });
    let best: (MockMatch & { score: number }) | null = null;

    for (const route of routes) {
        if (route.method !== method && !(method === 'HEAD' && route.method === 'GET')) {
            continue;
        }

        if (route.segments.length !== parts.length) {
            continue;
        }

        const params: Record<string, string> = {};
        let score = 0;
        const matches = route.segments.every((segment, i) => {
            if ('literal' in segment) {
                score += 2;

                return segment.literal === parts[i];
            }

            params[segment.param] = parts[i]!;

            return true;
        });

        // Empate: a de método exato vence (GET sobre HEAD).
        score += route.method === method ? 1 : 0;

        if (matches && (!best || score > best.score)) {
            best = { route, params, score };
        }
    }

    return best && { route: best.route, params: best.params };
}

/** Exemplo pedido pelo nome (header `X-Otto-Example` ou `?__example=`), senão o primeiro. */
export function pickExample(examples: readonly ResponseExample[], wanted: string | null): ResponseExample | null {
    const name = wanted?.trim().toLowerCase();

    return (name && examples.find((example) => example.name.toLowerCase() === name)) || examples[0] || null;
}

export interface MockRequestContext {
    params: Record<string, string>;
    query: URLSearchParams;
    headers: Record<string, string | string[] | undefined>;
    /** Corpo da requisição já decodificado como JSON, quando possível. */
    body: unknown;
}

const lookup = (value: unknown, path: string): unknown => path.split('.').reduce<unknown>((current, key) => (current !== null && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined), value);

const asText = (value: unknown): string => (value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value));

/** Troca as expressões dinâmicas do corpo/headers do exemplo pelos valores da chamada. */
export function renderMockTemplate(text: string, context: MockRequestContext): string {
    return text.replace(/\{\{\s*\$(\w+)(?:\.([\w.-]+))?\s*\}\}/g, (match, kind: string, key: string | undefined) => {
        switch (kind) {
            case 'params':
                return key ? (context.params[key] ?? '') : asText(context.params);
            case 'query':
                return key ? (context.query.get(key) ?? '') : asText(Object.fromEntries(context.query));
            case 'header': {
                const value = key ? context.headers[key.toLowerCase()] : undefined;

                return Array.isArray(value) ? value.join(', ') : (value ?? '');
            }
            case 'body':
                return asText(key ? lookup(context.body, key) : context.body);
            case 'uuid':
                return crypto.randomUUID();
            case 'now':
                return new Date().toISOString();
            case 'timestamp':
                return String(Date.now());
            case 'randomInt':
                return String(Math.floor(Math.random() * 1000));
            default:
                return match;
        }
    });
}
