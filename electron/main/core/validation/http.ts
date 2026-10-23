import * as path from 'node:path';
import { HTTP_METHODS, SEND_TIME_AUTH_TYPES, type HttpMultipartPart, type HttpRequest, type HttpRequestSource, type SendTimeAuth } from '../../../shared/models';
import { isRecord, parseEntityId, requireArray, requireBoolean, requireOneOf, requireRecord, requireString, ValidationError } from './guards';
import { parseRequestAuth } from './request';

/** Arquivos enviados no corpo precisam de caminho absoluto (escolhidos pelo usuário no seletor). */
function parseFilePath(raw: unknown, field: string): string {
    const file = requireString(raw, field, { maxLength: 4_096 });

    if (!path.isAbsolute(file)) {
        throw new ValidationError(field, 'must be an absolute file path');
    }

    return path.normalize(file);
}

function parseMultipart(raw: unknown): HttpMultipartPart[] {
    return requireArray(raw, 'request.multipart', 500).map((item, i) => {
        const part = requireRecord(item, `request.multipart[${i}]`);
        const file = requireBoolean(part['file'], `request.multipart[${i}].file`);

        return {
            name: requireString(part['name'], `request.multipart[${i}].name`, { maxLength: 1_000 }),
            value: file ? parseFilePath(part['value'], `request.multipart[${i}].value`) : requireString(part['value'], `request.multipart[${i}].value`, { allowEmpty: true, maxLength: 10_000_000 }),
            file
        };
    });
}

function parseSendTimeAuth(raw: unknown): SendTimeAuth {
    const auth = parseRequestAuth(raw);

    if (!(SEND_TIME_AUTH_TYPES as readonly string[]).includes(auth.type)) {
        throw new ValidationError('request.auth.type', `must be one of ${SEND_TIME_AUTH_TYPES.join(', ')}`);
    }

    return auth as SendTimeAuth;
}

function parseSource(raw: unknown): HttpRequestSource | undefined {
    if (raw === undefined || raw === null) {
        return undefined;
    }

    const { collectionId, requestPath } = requireRecord(raw, 'request.source');

    return {
        collectionId: parseEntityId(collectionId, 'request.source.collectionId'),
        requestPath: requireString(requestPath, 'request.source.requestPath', { maxLength: 4_096 })
    };
}

export function parseHttpRequest(raw: unknown): HttpRequest {
    const { id, method, url, body, bodyFile, multipart, auth, timeoutMs, source, redact, headers: rawHeaders } = requireRecord(raw, 'request');
    const headers: Record<string, string> = {};
    const parsedSource = parseSource(source);

    if (isRecord(rawHeaders)) {
        for (const [key, value] of Object.entries(rawHeaders)) {
            if (typeof value === 'string' && key.trim()) {
                headers[key.trim()] = value;
            }
        }
    }

    return {
        id: parseEntityId(id, 'request.id'),
        method: requireOneOf(method, HTTP_METHODS, 'request.method'),
        url: requireString(url, 'request.url', { allowEmpty: true, maxLength: 100_000 }).trim(),
        headers,
        body: typeof body === 'string' ? body : undefined,
        ...(bodyFile !== undefined && bodyFile !== null && { bodyFile: parseFilePath(bodyFile, 'request.bodyFile') }),
        ...(multipart !== undefined && multipart !== null && { multipart: parseMultipart(multipart) }),
        ...(auth !== undefined && auth !== null && { auth: parseSendTimeAuth(auth) }),
        timeoutMs: typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : undefined,
        ...(parsedSource && { source: parsedSource }),
        ...(Array.isArray(redact) && { redact: redact.filter((value): value is string => typeof value === 'string' && value.length <= 100_000).slice(0, 500) })
    };
}

export const parseRequestId = (raw: unknown): string => parseEntityId(raw, 'requestId');
