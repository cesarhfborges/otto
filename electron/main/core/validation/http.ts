import * as path from 'node:path';
import { HTTP_METHODS, type HttpMultipartPart, type HttpRequest, type HttpRequestSource } from '../../../shared/models';
import { isRecord, parseEntityId, requireArray, requireBoolean, requireOneOf, requireRecord, requireString, ValidationError } from './guards';

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

function parseWsse(raw: unknown): HttpRequest['wsse'] {
    const wsse = requireRecord(raw, 'request.wsse');

    return { username: requireString(wsse['username'], 'request.wsse.username', { allowEmpty: true, maxLength: 1_000 }), password: requireString(wsse['password'], 'request.wsse.password', { allowEmpty: true, maxLength: 10_000 }) };
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
    const { id, method, url, body, bodyFile, multipart, wsse, timeoutMs, source, headers: rawHeaders } = requireRecord(raw, 'request');
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
        ...(wsse !== undefined && wsse !== null && { wsse: parseWsse(wsse) }),
        timeoutMs: typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : undefined,
        ...(parsedSource && { source: parsedSource })
    };
}

export const parseRequestId = (raw: unknown): string => parseEntityId(raw, 'requestId');
