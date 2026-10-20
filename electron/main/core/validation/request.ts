import { AUTH_TYPES, BODY_TYPES, HTTP_METHODS, type KeyValue, type MultipartField, type RequestAuth, type RequestBody, type RequestDefinition } from '../../../shared/models';
import { requireArray, requireBoolean, requireInteger, requireOneOf, requireRecord, requireString, ValidationError } from './guards';

export const MAX_KEY_VALUES = 500;
export const MAX_BODY_LENGTH = 10_000_000;

const text = (value: unknown, field: string, maxLength = 100_000): string => (value === undefined || value === null ? '' : requireString(value, field, { allowEmpty: true, maxLength }));

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
            return { type, username: text(auth['username'], 'auth.username'), password: text(auth['password'], 'auth.password') };
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

/**
 * Valida uma requisição vinda do renderer ou de um arquivo da coleção.
 * Campos opcionais ausentes recebem valores padrão (arquivos editados à mão costumam omiti-los).
 */
export function parseRequestDefinition(raw: unknown): RequestDefinition {
    const request = requireRecord(raw, 'request');
    const method = typeof request['method'] === 'string' ? request['method'].toUpperCase() : request['method'];

    return {
        name: requireString(request['name'], 'request.name', { maxLength: 200 }).trim(),
        method: requireOneOf(method, HTTP_METHODS, 'request.method'),
        url: text(request['url'], 'request.url'),
        seq: request['seq'] === undefined || request['seq'] === null ? null : requireInteger(request['seq'], 'request.seq', 0),
        params: parseKeyValues(request['params'], 'request.params'),
        headers: parseKeyValues(request['headers'], 'request.headers'),
        auth: parseRequestAuth(request['auth']),
        body: parseRequestBody(request['body']),
        docs: text(request['docs'], 'request.docs', 1_000_000),
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
