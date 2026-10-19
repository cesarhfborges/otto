import * as path from 'node:path';
import type { CollectionSource, NewCollectionMetadata } from '../../../shared/models';
import { optionalString, pickDefined, requireOneOf, requireRecord, requireString, ValidationError } from './guards';

const SOURCE_KINDS = ['openapi'] as const;

function parseCollectionPath(raw: unknown): string {
    const value = requireString(raw, 'collection.path', { maxLength: 4_096 });

    if (!path.isAbsolute(value)) {
        throw new ValidationError('collection.path', 'must be an absolute path');
    }

    return path.normalize(value);
}

function parseCollectionSource(raw: unknown): CollectionSource | null {
    if (raw === null || raw === undefined) {
        return null;
    }

    const source = requireRecord(raw, 'collection.source');

    return {
        kind: requireOneOf(source['kind'], SOURCE_KINDS, 'collection.source.kind'),
        location: requireString(source['location'], 'collection.source.location', { maxLength: 4_096 }),
        lastHash: optionalString(source['lastHash'], 'collection.source.lastHash', { maxLength: 200 }),
        lastCheckedAt: optionalString(source['lastCheckedAt'], 'collection.source.lastCheckedAt', { maxLength: 64 })
    };
}

const parseName = (raw: unknown): string => requireString(raw, 'collection.name', { maxLength: 200 }).trim();

const parseLastOpenedAt = (raw: unknown): string | null => optionalString(raw, 'collection.lastOpenedAt', { maxLength: 64 });

export function parseNewCollection(raw: unknown): NewCollectionMetadata {
    const input = requireRecord(raw, 'collection');

    return {
        name: parseName(input['name']),
        path: parseCollectionPath(input['path']),
        source: parseCollectionSource(input['source']),
        lastOpenedAt: parseLastOpenedAt(input['lastOpenedAt'])
    };
}

export function parseCollectionPatch(raw: unknown): Partial<NewCollectionMetadata> {
    return pickDefined<NewCollectionMetadata>(requireRecord(raw, 'patch'), {
        name: parseName,
        path: parseCollectionPath,
        source: parseCollectionSource,
        lastOpenedAt: parseLastOpenedAt
    });
}
