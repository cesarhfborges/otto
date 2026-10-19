import { HTTP_METHODS, type HttpRequest } from '../../../shared/models';
import { isRecord, parseEntityId, requireOneOf, requireRecord, requireString } from './guards';

export function parseHttpRequest(raw: unknown): HttpRequest {
    const { id, method, url, body, timeoutMs, headers: rawHeaders } = requireRecord(raw, 'request');
    const headers: Record<string, string> = {};

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
        timeoutMs: typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : undefined
    };
}

export const parseRequestId = (raw: unknown): string => parseEntityId(raw, 'requestId');
