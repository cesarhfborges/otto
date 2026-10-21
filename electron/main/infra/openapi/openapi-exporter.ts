import type { HttpMethod, KeyValue, RequestAuth, RequestBody, RequestDefinition } from '../../../shared/models';

type Json = Record<string, unknown>;

export interface ExportableCollection {
    name: string;
    description: string;
    /** Valores de `baseUrl` dos ambientes da coleção (viram `servers`). */
    servers: string[];
    /** Requisições com o caminho do arquivo (a primeira pasta vira a tag). */
    requests: Array<{ path: string; request: RequestDefinition }>;
}

/** Headers que o OpenAPI descreve por outros meios (content negotiation, security). */
const RESERVED_HEADERS = new Set(['accept', 'content-type', 'authorization']);

const enabled = <T extends KeyValue>(items: T[]): T[] => items.filter((item) => item.enabled && item.key.trim());

/**
 * `{{$.baseUrl}}/users/{{$.id}}?x=1` (ou a forma antiga `{{id}}`) → `/users/{id}`. Variáveis no início e origem absoluta
 * (`https://host`) são descartadas: o servidor vem dos ambientes.
 */
export function toOpenApiPath(url: string): string {
    let rest = url.trim().split(/[?#]/)[0]!;

    rest = rest.replace(/^(\{\{[^}]+\}\})+/, '').replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');

    const path = rest
        .split('/')
        .map((segment) => segment.replace(/\{\{\s*(?:\$(?:env|collection)?\.)?([^}\s]+)\s*\}\}/g, '{$1}').replace(/^:([A-Za-z0-9_.-]+)$/, '{$1}'))
        .join('/');

    return path.startsWith('/') ? path || '/' : `/${path}`;
}

function exampleOf(content: string): unknown {
    try {
        return JSON.parse(content);
    } catch {
        return content;
    }
}

function fieldsSchema(fields: Array<KeyValue & { kind?: 'text' | 'file' }>): Json {
    const properties: Json = {};

    for (const field of enabled(fields)) {
        properties[field.key] = field.kind === 'file' ? { type: 'string', format: 'binary' } : { type: 'string', example: field.value };
    }

    return { type: 'object', properties };
}

function requestBody(body: RequestBody): Json | null {
    switch (body.type) {
        case 'json':
            return { content: { 'application/json': { example: exampleOf(body.content) } } };
        case 'xml':
            return { content: { 'application/xml': { example: body.content } } };
        case 'text':
            return { content: { 'text/plain': { example: body.content } } };
        case 'form-urlencoded':
            return { content: { 'application/x-www-form-urlencoded': { schema: fieldsSchema(body.fields) } } };
        case 'multipart-form':
            return { content: { 'multipart/form-data': { schema: fieldsSchema(body.fields) } } };
        case 'binary':
            return { content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } };
        default:
            return null;
    }
}

/** Nome e definição do security scheme da autenticação da requisição. */
function securityScheme(auth: RequestAuth): [string, Json] | null {
    switch (auth.type) {
        case 'bearer':
            return ['bearerAuth', { type: 'http', scheme: 'bearer' }];
        case 'basic':
            return ['basicAuth', { type: 'http', scheme: 'basic' }];
        case 'apikey':
            return [`apiKey_${auth.in}_${auth.key}`, { type: 'apiKey', name: auth.key, in: auth.in }];
        case 'wsse':
            return ['wsse', { type: 'apiKey', name: 'X-WSSE', in: 'header', description: 'WS-Security UsernameToken' }];
        default:
            return null;
    }
}

/** Gera um documento OpenAPI 3.0 a partir das requisições da coleção. */
export function buildOpenApiSpec(collection: ExportableCollection): Json {
    const paths: Record<string, Json> = {};
    const schemes: Json = {};
    const tags = new Set<string>();

    for (const { path: file, request } of collection.requests) {
        const route = toOpenApiPath(request.url);
        const method = request.method.toLowerCase() as Lowercase<HttpMethod>;
        const item = (paths[route] ??= {});

        // Duas requisições para o mesmo `METODO caminho` não cabem no OpenAPI: vale a primeira.
        if (item[method]) {
            continue;
        }

        const folder = file.includes('/') ? file.split('/')[0]! : '';
        const pathParams = [...route.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
        const parameters = [
            ...pathParams.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
            ...enabled(request.params).map((param) => ({ name: param.key, in: 'query', schema: { type: 'string' }, example: param.value, ...(param.description && { description: param.description }) })),
            ...enabled(request.headers)
                .filter((header) => !RESERVED_HEADERS.has(header.key.toLowerCase()))
                .map((header) => ({ name: header.key, in: 'header', schema: { type: 'string' }, example: header.value, ...(header.description && { description: header.description }) }))
        ];
        const body = requestBody(request.body);
        const scheme = securityScheme(request.auth);

        if (folder) {
            tags.add(folder);
        }

        if (scheme) {
            schemes[scheme[0]] = scheme[1];
        }

        item[method] = {
            summary: request.name,
            ...(request.docs && { description: request.docs }),
            ...(folder && { tags: [folder] }),
            ...(parameters.length && { parameters }),
            ...(body && { requestBody: body }),
            ...(scheme && { security: [{ [scheme[0]]: [] }] }),
            responses: { default: { description: 'Response' } }
        };
    }

    return {
        openapi: '3.0.3',
        info: { title: collection.name, version: '1.0.0', ...(collection.description && { description: collection.description }) },
        ...(collection.servers.length && { servers: collection.servers.map((url) => ({ url })) }),
        ...(tags.size && { tags: [...tags].map((name) => ({ name })) }),
        paths,
        ...(Object.keys(schemes).length && { components: { securitySchemes: schemes } })
    };
}
