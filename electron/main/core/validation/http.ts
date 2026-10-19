import { HTTP_METHODS, type HttpRequest, type HttpRequestSource } from '../../../shared/models';
import { isRecord, parseEntityId, requireOneOf, requireRecord, requireString } from './guards';

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
    const { id, method, url, body, timeoutMs, source, headers: rawHeaders } = requireRecord(raw, 'request');
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
        timeoutMs: typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : undefined,
        ...(parsedSource && { source: parsedSource })
    };
}

export const parseRequestId = (raw: unknown): string => parseEntityId(raw, 'requestId');
