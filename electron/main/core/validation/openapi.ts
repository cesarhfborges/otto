import { OPENAPI_CHECK_INTERVALS, OPENAPI_GROUPINGS, type OpenApiCheckInterval, type OpenApiConfig } from '../../../shared/models';
import { requireBoolean, requireOneOf, requireRecord, requireString, ValidationError } from './guards';

function parseInterval(raw: unknown, field: string): OpenApiCheckInterval {
    if (raw === undefined) {
        return 15;
    }

    if (!OPENAPI_CHECK_INTERVALS.includes(raw as OpenApiCheckInterval)) {
        throw new ValidationError(field, `expected one of ${OPENAPI_CHECK_INTERVALS.join(', ')}`);
    }

    return raw as OpenApiCheckInterval;
}

/** Configuração da ligação com o spec (do `otto.yaml` ou vinda do renderer). */
export function parseOpenApiConfig(raw: unknown, field = 'openapi'): OpenApiConfig {
    const config = requireRecord(raw, field);
    const source = requireRecord(config['source'], `${field}.source`);
    const type = requireOneOf(source['type'], ['url', 'file'] as const, `${field}.source.type`);
    const location = requireString(source['location'], `${field}.source.location`, { maxLength: 4_096 }).trim();

    if (type === 'url' && !/^https?:\/\//i.test(location)) {
        throw new ValidationError(`${field}.source.location`, 'must be an http(s) URL');
    }

    return {
        source: { type, location },
        autoCheck: config['autoCheck'] === undefined ? false : requireBoolean(config['autoCheck'], `${field}.autoCheck`),
        intervalMinutes: parseInterval(config['intervalMinutes'], `${field}.intervalMinutes`),
        groupBy: config['groupBy'] === undefined ? 'tags' : requireOneOf(config['groupBy'], OPENAPI_GROUPINGS, `${field}.groupBy`)
    };
}
