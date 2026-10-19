import type { HistoryQuery } from '../../../shared/models';
import { parseEntityId, pickDefined, requireInteger, requireRecord } from './guards';

export function parseHistoryQuery(raw: unknown): HistoryQuery {
    if (raw === undefined || raw === null) {
        return {};
    }

    return pickDefined<HistoryQuery>(requireRecord(raw, 'query'), {
        limit: (v) => requireInteger(v, 'query.limit', 1),
        offset: (v) => requireInteger(v, 'query.offset', 0),
        collectionId: (v) => parseEntityId(v, 'query.collectionId')
    });
}
