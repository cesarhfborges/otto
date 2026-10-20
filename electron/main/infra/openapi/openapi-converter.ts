import { HTTP_METHODS, type HttpMethod, type KeyValue, type MultipartField, type OpenApiGrouping, type OpenApiSpecInfo, type RequestAuth, type RequestBody, type RequestDefinition } from '../../../shared/models';
import { parseYaml } from '../yaml';

type Json = Record<string, unknown>;

/** Operação do spec convertida em requisição do Otto. */
export interface SpecOperation {
    /** `MÉTODO /caminho` (identifica a operação entre versões do spec). */
    key: string;
    method: HttpMethod;
    path: string;
    operationId: string | null;
    /** Pasta da coleção (tag ou primeiro segmento do caminho); `''` = raiz. */
    folder: string;
    request: RequestDefinition;
}

export interface ConvertedSpec {
    info: OpenApiSpecInfo;
    operations: SpecOperation[];
}

const MAX_SCHEMA_DEPTH = 8;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Nome de pasta seguro (sem separadores nem ponto inicial). */
const folderName = (value: string): string =>
    value
        .replace(/[/\\\0]/g, '-')
        .replace(/^\.+/, '')
        .trim()
        .slice(0, 80);

/** `{id}` (OpenAPI) → `{{id}}` (variável do Otto). */
const toOttoPath = (path: string): string => path.replace(/\{([^}]+)\}/g, '{{$1}}');

/** Resolve `$ref` locais (`#/components/schemas/X`), com proteção contra ciclos. */
class RefResolver {
    constructor(private readonly root: Json) {}

    resolve(value: unknown, seen = new Set<string>()): unknown {
        if (!isObject(value) || typeof value['$ref'] !== 'string') {
            return value;
        }

        const ref = value['$ref'];

        if (!ref.startsWith('#/') || seen.has(ref)) {
            return {};
        }

        const target = ref
            .slice(2)
            .split('/')
            .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
            .reduce<unknown>((node, part) => (isObject(node) ? node[part] : undefined), this.root);

        return this.resolve(target, new Set([...seen, ref]));
    }
}

/** Exemplo a partir do schema: `example`/`default`/`enum` primeiro, depois um valor do tipo. */
function sample(schemaRaw: unknown, refs: RefResolver, depth = 0, seen = new Set<unknown>()): unknown {
    const schema = refs.resolve(schemaRaw);

    if (!isObject(schema) || depth > MAX_SCHEMA_DEPTH || seen.has(schema)) {
        return null;
    }

    const nextSeen = new Set(seen).add(schema);

    if (schema['example'] !== undefined) {
        return schema['example'];
    }

    if (schema['default'] !== undefined) {
        return schema['default'];
    }

    if (Array.isArray(schema['enum']) && schema['enum'].length) {
        return schema['enum'][0];
    }

    if (Array.isArray(schema['allOf'])) {
        return schema['allOf'].reduce<Json>((merged, part) => {
            const value = sample(part, refs, depth + 1, nextSeen);

            return isObject(value) ? { ...merged, ...value } : merged;
        }, {});
    }

    for (const key of ['oneOf', 'anyOf']) {
        if (Array.isArray(schema[key]) && schema[key].length) {
            return sample(schema[key][0], refs, depth + 1, nextSeen);
        }
    }

    const type = Array.isArray(schema['type']) ? schema['type'].find((t) => t !== 'null') : schema['type'];

    if (type === 'object' || isObject(schema['properties'])) {
        const properties = isObject(schema['properties']) ? schema['properties'] : {};

        return Object.fromEntries(Object.entries(properties).map(([name, property]) => [name, sample(property, refs, depth + 1, nextSeen)]));
    }

    if (type === 'array') {
        const item = sample(schema['items'], refs, depth + 1, nextSeen);

        return item === null ? [] : [item];
    }

    switch (type) {
        case 'integer':
        case 'number':
            return 0;
        case 'boolean':
            return false;
        case 'string':
            return schema['format'] === 'date-time' ? new Date(0).toISOString() : schema['format'] === 'date' ? '1970-01-01' : schema['format'] === 'uuid' ? '00000000-0000-0000-0000-000000000000' : 'string';
        default:
            return null;
    }
}

const sampleText = (value: unknown): string => (value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value));

/** Campos de formulário a partir das propriedades do schema. */
function formFields(schemaRaw: unknown, refs: RefResolver): Array<KeyValue & { binary: boolean }> {
    const schema = refs.resolve(schemaRaw);
    const properties = isObject(schema) && isObject(schema['properties']) ? schema['properties'] : {};
    const required = new Set(isObject(schema) && Array.isArray(schema['required']) ? schema['required'] : []);

    return Object.entries(properties).map(([key, propertyRaw]) => {
        const property = refs.resolve(propertyRaw);
        const binary = isObject(property) && (property['format'] === 'binary' || property['type'] === 'file');
        const description = isObject(property) ? str(property['description']) : '';

        return { key, value: binary ? '' : sampleText(sample(property, refs)), enabled: required.has(key) || !binary, binary, ...(description && { description }) };
    });
}

function bodyFromContent(content: Json, refs: RefResolver): { body: RequestBody; contentType: string | null } {
    const types = Object.keys(content);
    const pick = (predicate: (type: string) => boolean): string | undefined => types.find(predicate);
    const json = pick((t) => /json/i.test(t));
    const urlencoded = pick((t) => t === 'application/x-www-form-urlencoded');
    const multipart = pick((t) => t.startsWith('multipart/'));
    const xml = pick((t) => /xml/i.test(t));
    const text = pick((t) => t.startsWith('text/'));
    const binary = pick((t) => t === 'application/octet-stream' || t.startsWith('image/') || t.startsWith('application/pdf'));
    const mediaOf = (type: string): Json => (isObject(content[type]) ? content[type] : {});
    const exampleOf = (media: Json): unknown => {
        if (media['example'] !== undefined) {
            return media['example'];
        }

        if (isObject(media['examples'])) {
            const first = refs.resolve(Object.values(media['examples'])[0]);

            if (isObject(first) && first['value'] !== undefined) {
                return first['value'];
            }
        }

        return sample(media['schema'], refs);
    };

    if (json) {
        const example = exampleOf(mediaOf(json));

        return { body: { type: 'json', content: example === null ? '' : JSON.stringify(example, null, 2) }, contentType: json === 'application/json' ? null : json };
    }

    if (urlencoded) {
        return { body: { type: 'form-urlencoded', fields: formFields(mediaOf(urlencoded)['schema'], refs).map(({ binary: _binary, ...field }) => field) }, contentType: null };
    }

    if (multipart) {
        return { body: { type: 'multipart-form', fields: formFields(mediaOf(multipart)['schema'], refs).map(({ binary, ...field }): MultipartField => ({ ...field, kind: binary ? 'file' : 'text' })) }, contentType: null };
    }

    if (xml) {
        return { body: { type: 'xml', content: sampleText(mediaOf(xml)['example']) }, contentType: xml === 'application/xml' ? null : xml };
    }

    if (text) {
        return { body: { type: 'text', content: sampleText(exampleOf(mediaOf(text))) }, contentType: text === 'text/plain' ? null : text };
    }

    if (binary) {
        return { body: { type: 'binary', file: '' }, contentType: binary === 'application/octet-stream' ? null : binary };
    }

    return { body: { type: 'none' }, contentType: null };
}

/** Primeiro requisito de segurança da operação (ou global) convertido em auth do Otto. */
function authFrom(security: unknown, schemes: Json, refs: RefResolver): RequestAuth {
    const requirement = Array.isArray(security) ? security.find(isObject) : undefined;
    const name = requirement ? Object.keys(requirement)[0] : undefined;
    const scheme = name ? refs.resolve(schemes[name]) : undefined;

    if (!isObject(scheme)) {
        return { type: 'none' };
    }

    const type = str(scheme['type']).toLowerCase();
    const httpScheme = str(scheme['scheme']).toLowerCase();

    if (type === 'basic' || (type === 'http' && httpScheme === 'basic')) {
        return { type: 'basic', username: '{{username}}', password: '{{password}}' };
    }

    if ((type === 'http' && httpScheme === 'bearer') || type === 'oauth2' || type === 'openidconnect') {
        return { type: 'bearer', token: '{{token}}' };
    }

    if (type === 'apikey') {
        const where = str(scheme['in']);

        return { type: 'apikey', key: str(scheme['name']) || 'X-API-Key', value: '{{apiKey}}', in: where === 'query' ? 'query' : 'header' };
    }

    return { type: 'none' };
}

function serversOf(spec: Json): string[] {
    if (Array.isArray(spec['servers'])) {
        return spec['servers']
            .filter(isObject)
            .map((server) => str(server['url']))
            .filter(Boolean);
    }

    // Swagger 2.0: schemes + host + basePath.
    if (typeof spec['host'] === 'string') {
        const scheme = Array.isArray(spec['schemes']) && typeof spec['schemes'][0] === 'string' ? spec['schemes'][0] : 'https';

        return [`${scheme}://${spec['host']}${str(spec['basePath'])}`];
    }

    return [];
}

function folderFor(operation: Json, path: string, groupBy: OpenApiGrouping): string {
    if (groupBy === 'tags' && Array.isArray(operation['tags']) && typeof operation['tags'][0] === 'string') {
        return folderName(operation['tags'][0]);
    }

    const segment = path.split('/').find((part) => part && !part.startsWith('{'));

    return segment ? folderName(segment) : '';
}

/** Lê o texto (JSON ou YAML) e valida que é OpenAPI 3.x ou Swagger 2.0. */
export function parseSpec(text: string): Json {
    const spec = parseYaml(text);

    if (!isObject(spec)) {
        throw new Error('The spec is not a JSON/YAML object');
    }

    if (!(typeof spec['openapi'] === 'string' && spec['openapi'].startsWith('3')) && spec['swagger'] !== '2.0') {
        throw new Error('Not an OpenAPI 3.x or Swagger 2.0 document (missing "openapi" or "swagger" field)');
    }

    if (!isObject(spec['paths'])) {
        throw new Error('The spec has no "paths"');
    }

    return spec;
}

/** Converte o spec em requisições, na ordem em que aparecem. */
export function convertSpec(spec: Json, groupBy: OpenApiGrouping): ConvertedSpec {
    const refs = new RefResolver(spec);
    const swagger2 = spec['swagger'] === '2.0';
    const components = isObject(spec['components']) ? spec['components'] : {};
    const schemes = swagger2 ? (isObject(spec['securityDefinitions']) ? spec['securityDefinitions'] : {}) : isObject(components['securitySchemes']) ? components['securitySchemes'] : {};
    const info = isObject(spec['info']) ? spec['info'] : {};
    const operations: SpecOperation[] = [];
    const seqByFolder = new Map<string, number>();

    for (const [path, pathItemRaw] of Object.entries(spec['paths'] as Json)) {
        const pathItem = refs.resolve(pathItemRaw);

        if (!isObject(pathItem)) {
            continue;
        }

        const pathParameters = Array.isArray(pathItem['parameters']) ? pathItem['parameters'] : [];

        for (const method of HTTP_METHODS) {
            const operation = pathItem[method.toLowerCase()];

            if (!isObject(operation)) {
                continue;
            }

            // Parâmetros da operação sobrepõem os do caminho (mesmo nome + local).
            const parameters = new Map<string, Json>();

            for (const raw of [...pathParameters, ...(Array.isArray(operation['parameters']) ? operation['parameters'] : [])]) {
                const parameter = refs.resolve(raw);

                if (isObject(parameter)) {
                    parameters.set(`${str(parameter['in'])}:${str(parameter['name'])}`, parameter);
                }
            }

            const valueOf = (parameter: Json): string => sampleText(parameter['example'] ?? (swagger2 ? (parameter['default'] ?? parameter['x-example']) : sample(parameter['schema'], refs)) ?? '');
            const pairsIn = (location: string): KeyValue[] =>
                [...parameters.values()]
                    .filter((parameter) => parameter['in'] === location)
                    .map((parameter) => {
                        const description = str(parameter['description']);

                        return { key: str(parameter['name']), value: valueOf(parameter) === 'null' ? '' : valueOf(parameter), enabled: parameter['required'] === true, ...(description && { description }) };
                    });

            const headers = pairsIn('header').filter((header) => !/^(authorization|content-type|accept)$/i.test(header.key));
            let body: RequestBody = { type: 'none' };

            if (swagger2) {
                const bodyParameter = [...parameters.values()].find((parameter) => parameter['in'] === 'body');
                const formData = [...parameters.values()].filter((parameter) => parameter['in'] === 'formData');

                if (bodyParameter) {
                    const example = sample(bodyParameter['schema'], refs);

                    body = { type: 'json', content: example === null ? '' : JSON.stringify(example, null, 2) };
                } else if (formData.length) {
                    const hasFile = formData.some((parameter) => parameter['type'] === 'file');
                    const fields = formData.map(
                        (parameter): MultipartField => ({ key: str(parameter['name']), value: parameter['type'] === 'file' ? '' : valueOf(parameter), enabled: parameter['required'] === true, kind: parameter['type'] === 'file' ? 'file' : 'text' })
                    );

                    body = hasFile ? { type: 'multipart-form', fields } : { type: 'form-urlencoded', fields: fields.map(({ kind: _kind, ...field }) => field) };
                }
            } else {
                const requestBody = refs.resolve(operation['requestBody']);

                if (isObject(requestBody) && isObject(requestBody['content'])) {
                    const converted = bodyFromContent(requestBody['content'], refs);

                    body = converted.body;

                    if (converted.contentType) {
                        headers.push({ key: 'Content-Type', value: converted.contentType, enabled: true });
                    }
                }
            }

            const folder = folderFor(operation, path, groupBy);
            const seq = (seqByFolder.get(folder) ?? 0) + 1;
            const operationId = typeof operation['operationId'] === 'string' ? operation['operationId'] : null;
            const key = `${method} ${path}`;
            const description = [str(operation['summary']) && str(operation['description']) ? str(operation['summary']) : '', str(operation['description'])].filter(Boolean).join('\n\n');

            seqByFolder.set(folder, seq);
            operations.push({
                key,
                method,
                path,
                operationId,
                folder,
                request: {
                    name: (str(operation['summary']) || operationId || key).slice(0, 200),
                    method,
                    url: `{{baseUrl}}${toOttoPath(path)}`,
                    seq,
                    params: pairsIn('query'),
                    headers,
                    auth: authFrom(operation['security'] ?? spec['security'], schemes, refs),
                    body,
                    docs: description,
                    operation: key
                }
            });
        }
    }

    return {
        info: {
            title: str(info['title']) || 'Untitled API',
            version: str(info['version']),
            format: swagger2 ? '2.0' : str(spec['openapi']),
            servers: serversOf(spec),
            endpointCount: operations.length
        },
        operations
    };
}
