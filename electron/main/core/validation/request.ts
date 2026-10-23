import {
    AUTH_TYPES,
    BODY_TYPES,
    HAWK_ALGORITHMS,
    OAUTH1_SIGNATURE_METHODS,
    OAUTH2_GRANT_TYPES,
    HTTP_METHODS,
    type CollectionCookie,
    type KeyValue,
    type MultipartField,
    type RequestAuth,
    type RequestBody,
    type RequestDefinition,
    type ResponseExample
} from '../../../shared/models';
import { requireArray, requireBoolean, requireInteger, requireOneOf, requireRecord, requireString, ValidationError } from './guards';

export const MAX_KEY_VALUES = 500;
export const MAX_BODY_LENGTH = 10_000_000;

const text = (value: unknown, field: string, maxLength = 100_000): string => (value === undefined || value === null ? '' : requireString(value, field, { allowEmpty: true, maxLength }));

/** Campo de enum opcional: ausente usa o padrão. */
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T, field: string): T => (value === undefined || value === null ? fallback : requireOneOf(value, allowed, field));

export function parseKeyValues(raw: unknown, field: string): KeyValue[] {
    if (raw === undefined || raw === null) {
        return [];
    }

    return requireArray(raw, field, MAX_KEY_VALUES).map((item, i) => {
        const entry = requireRecord(item, `${field}[${i}]`);

        const description = text(entry['description'], `${field}[${i}].description`, 2_000);

        return {
            key: text(entry['key'], `${field}[${i}].key`, 1_000),
            value: text(entry['value'], `${field}[${i}].value`),
            enabled: entry['enabled'] === undefined ? true : requireBoolean(entry['enabled'], `${field}[${i}].enabled`),
            ...(description && { description })
        };
    });
}

function parseMultipartFields(raw: unknown, field: string): MultipartField[] {
    const kinds = raw === undefined || raw === null ? [] : requireArray(raw, field, MAX_KEY_VALUES).map((item, i) => requireRecord(item, `${field}[${i}]`)['kind']);

    return parseKeyValues(raw, field).map((entry, i) => ({ ...entry, kind: kinds[i] === undefined ? 'text' : requireOneOf(kinds[i], ['text', 'file'] as const, `${field}[${i}].kind`) }));
}

export function parseRequestAuth(raw: unknown): RequestAuth {
    if (raw === undefined || raw === null) {
        return { type: 'none' };
    }

    const auth = requireRecord(raw, 'auth');
    const type = requireOneOf(auth['type'], AUTH_TYPES, 'auth.type');

    switch (type) {
        case 'none':
        case 'inherit':
            return { type };
        case 'bearer': {
            const prefix = text(auth['prefix'], 'auth.prefix', 1_000);

            return { type, token: text(auth['token'], 'auth.token'), ...(prefix && { prefix }) };
        }
        case 'basic':
            return { type, username: text(auth['username'], 'auth.username'), password: text(auth['password'], 'auth.password') };
        case 'apikey':
            return { type, key: text(auth['key'], 'auth.key', 1_000), value: text(auth['value'], 'auth.value'), in: auth['in'] === undefined ? 'header' : requireOneOf(auth['in'], ['header', 'query'] as const, 'auth.in') };
        case 'wsse':
        case 'digest':
            return { type, username: text(auth['username'], 'auth.username'), password: text(auth['password'], 'auth.password') };
        case 'ntlm':
            return { type, username: text(auth['username'], 'auth.username'), password: text(auth['password'], 'auth.password'), domain: text(auth['domain'], 'auth.domain', 1_000), workstation: text(auth['workstation'], 'auth.workstation', 1_000) };
        case 'oauth1':
            return {
                type,
                signatureMethod: oneOf(auth['signatureMethod'], OAUTH1_SIGNATURE_METHODS, 'HMAC-SHA1', 'auth.signatureMethod'),
                consumerKey: text(auth['consumerKey'], 'auth.consumerKey'),
                consumerSecret: text(auth['consumerSecret'], 'auth.consumerSecret'),
                token: text(auth['token'], 'auth.token'),
                tokenSecret: text(auth['tokenSecret'], 'auth.tokenSecret'),
                privateKey: text(auth['privateKey'], 'auth.privateKey'),
                realm: text(auth['realm'], 'auth.realm', 1_000),
                addTo: oneOf(auth['addTo'], ['header', 'query'] as const, 'header', 'auth.addTo')
            };
        case 'oauth2':
            return {
                type,
                grantType: oneOf(auth['grantType'], OAUTH2_GRANT_TYPES, 'client_credentials', 'auth.grantType'),
                authUrl: text(auth['authUrl'], 'auth.authUrl'),
                accessTokenUrl: text(auth['accessTokenUrl'], 'auth.accessTokenUrl'),
                callbackUrl: text(auth['callbackUrl'], 'auth.callbackUrl'),
                clientId: text(auth['clientId'], 'auth.clientId'),
                clientSecret: text(auth['clientSecret'], 'auth.clientSecret'),
                username: text(auth['username'], 'auth.username'),
                password: text(auth['password'], 'auth.password'),
                scope: text(auth['scope'], 'auth.scope'),
                pkce: auth['pkce'] === undefined ? false : requireBoolean(auth['pkce'], 'auth.pkce'),
                clientAuth: oneOf(auth['clientAuth'], ['header', 'body'] as const, 'header', 'auth.clientAuth'),
                tokenPrefix: text(auth['tokenPrefix'], 'auth.tokenPrefix', 1_000),
                addTo: oneOf(auth['addTo'], ['header', 'query'] as const, 'header', 'auth.addTo')
            };
        case 'awsv4':
            return {
                type,
                accessKeyId: text(auth['accessKeyId'], 'auth.accessKeyId'),
                secretAccessKey: text(auth['secretAccessKey'], 'auth.secretAccessKey'),
                sessionToken: text(auth['sessionToken'], 'auth.sessionToken'),
                region: text(auth['region'], 'auth.region', 1_000),
                service: text(auth['service'], 'auth.service', 1_000)
            };
        case 'hawk':
            return { type, id: text(auth['id'], 'auth.id'), key: text(auth['key'], 'auth.key'), algorithm: oneOf(auth['algorithm'], HAWK_ALGORITHMS, 'sha256', 'auth.algorithm'), ext: text(auth['ext'], 'auth.ext') };
        case 'asap':
            return {
                type,
                issuer: text(auth['issuer'], 'auth.issuer'),
                audience: text(auth['audience'], 'auth.audience'),
                subject: text(auth['subject'], 'auth.subject'),
                keyId: text(auth['keyId'], 'auth.keyId'),
                privateKey: text(auth['privateKey'], 'auth.privateKey'),
                expiresIn: text(auth['expiresIn'], 'auth.expiresIn', 1_000)
            };
        case 'netrc':
            return { type };
    }
}

export function parseRequestBody(raw: unknown): RequestBody {
    if (raw === undefined || raw === null) {
        return { type: 'none' };
    }

    const body = requireRecord(raw, 'body');
    const type = requireOneOf(body['type'], BODY_TYPES, 'body.type');

    switch (type) {
        case 'none':
            return { type };
        case 'json':
        case 'text':
        case 'xml':
            return { type, content: text(body['content'], 'body.content', MAX_BODY_LENGTH) };
        case 'form-urlencoded':
            return { type, fields: parseKeyValues(body['fields'], 'body.fields') };
        case 'multipart-form':
            return { type, fields: parseMultipartFields(body['fields'], 'body.fields') };
        case 'binary':
            return { type, file: text(body['file'], 'body.file', 4_096) };
    }
}

/** `scripts` é opcional; scripts vazios não são guardados. */
function parseRequestScripts(raw: unknown): Pick<RequestDefinition, 'scripts'> {
    if (raw === undefined || raw === null) {
        return {};
    }

    const scripts = requireRecord(raw, 'request.scripts');
    const preRequest = text(scripts['preRequest'], 'request.scripts.preRequest', 1_000_000);
    const postResponse = text(scripts['postResponse'], 'request.scripts.postResponse', 1_000_000);

    return preRequest || postResponse ? { scripts: { ...(preRequest && { preRequest }), ...(postResponse && { postResponse }) } } : {};
}

const MAX_EXAMPLES = 50;

/** `examples` é opcional; lista vazia não é guardada. */
function parseResponseExamples(raw: unknown): Pick<RequestDefinition, 'examples'> {
    if (raw === undefined || raw === null) {
        return {};
    }

    const examples = requireArray(raw, 'request.examples', MAX_EXAMPLES).map((item, i): ResponseExample => {
        const example = requireRecord(item, `request.examples[${i}]`);

        return {
            name: text(example['name'], `request.examples[${i}].name`, 200).trim() || `Example ${i + 1}`,
            status: example['status'] === undefined ? 200 : requireInteger(example['status'], `request.examples[${i}].status`, 100, 599),
            headers: parseKeyValues(example['headers'], `request.examples[${i}].headers`),
            body: text(example['body'], `request.examples[${i}].body`, MAX_BODY_LENGTH),
            delayMs: example['delayMs'] === undefined ? 0 : requireInteger(example['delayMs'], `request.examples[${i}].delayMs`, 0, 60_000)
        };
    });

    return examples.length ? { examples } : {};
}

/**
 * Valida uma requisição vinda do renderer ou de um arquivo da coleção.
 * Campos opcionais ausentes recebem valores padrão (arquivos editados à mão costumam omiti-los).
 */
export function parseRequestDefinition(raw: unknown): RequestDefinition {
    const request = requireRecord(raw, 'request');
    const method = typeof request['method'] === 'string' ? request['method'].toUpperCase() : request['method'];

    const id = typeof request['id'] === 'string' && /^[\w-]{1,64}$/.test(request['id']) ? request['id'] : undefined;

    return {
        ...(id && { id }),
        name: requireString(request['name'], 'request.name', { maxLength: 200 }).trim(),
        method: requireOneOf(method, HTTP_METHODS, 'request.method'),
        url: text(request['url'], 'request.url'),
        seq: request['seq'] === undefined || request['seq'] === null ? null : requireInteger(request['seq'], 'request.seq', 0),
        params: parseKeyValues(request['params'], 'request.params'),
        headers: parseKeyValues(request['headers'], 'request.headers'),
        auth: parseRequestAuth(request['auth']),
        body: parseRequestBody(request['body']),
        docs: text(request['docs'], 'request.docs', 1_000_000),
        ...parseRequestScripts(request['scripts']),
        ...parseResponseExamples(request['examples']),
        ...(typeof request['operation'] === 'string' && request['operation'].trim() && { operation: request['operation'].trim().slice(0, 2_000) })
    };
}

/** Caminho relativo à raiz da coleção (validação estrutural completa fica no store). */
export function parseRelativePath(raw: unknown, field = 'path'): string {
    const value = requireString(raw, field, { allowEmpty: true, maxLength: 1_024 });

    if (value.includes('\0')) {
        throw new ValidationError(field, 'must not contain NUL characters');
    }

    return value;
}

/** Nome de pasta ou coleção: um único segmento, sem separadores e sem começar com ponto. */
export function parseEntryName(raw: unknown, field = 'name'): string {
    const value = requireString(raw, field, { maxLength: 120 }).trim();

    if (/[/\\\0]/.test(value) || value.startsWith('.')) {
        throw new ValidationError(field, 'must not contain "/", "\\" or start with "."');
    }

    return value;
}

const MAX_COOKIES = 1_000;

/** Cookies da coleção (`otto.yaml`). */
export function parseCookies(raw: unknown, field: string): CollectionCookie[] {
    if (raw === undefined || raw === null) {
        return [];
    }

    return requireArray(raw, field, MAX_COOKIES).map((item, i) => {
        const entry = requireRecord(item, `${field}[${i}]`);
        const flag = (name: string): boolean => (entry[name] === undefined ? false : requireBoolean(entry[name], `${field}[${i}].${name}`));
        const expires = entry['expires'] === undefined || entry['expires'] === null || entry['expires'] === '' ? null : text(entry['expires'], `${field}[${i}].expires`, 100);

        return {
            name: requireString(entry['name'], `${field}[${i}].name`, { maxLength: 1_000 }),
            value: text(entry['value'], `${field}[${i}].value`),
            domain: text(entry['domain'], `${field}[${i}].domain`, 1_000),
            path: text(entry['path'], `${field}[${i}].path`, 2_000) || '/',
            expires: expires && !Number.isNaN(Date.parse(expires)) ? new Date(expires).toISOString() : null,
            secure: flag('secure'),
            httpOnly: flag('httpOnly'),
            hostOnly: flag('hostOnly')
        };
    });
}
