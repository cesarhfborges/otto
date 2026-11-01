import * as path from 'node:path';
import { SCRIPT_MODES, SCRIPT_PERMISSIONS, type CollectionSource, type NewCollectionMetadata, type ScriptPermissions, type ScriptPolicyPatch } from '../../../shared/models';
import { requireBoolean, optionalString, pickDefined, requireOneOf, requireRecord, requireString, ValidationError } from './guards';

const SOURCE_KINDS = ['openapi'] as const;

/** Caminho absoluto de pasta (raiz de coleção ou pasta-mãe), normalizado. */
export function parseCollectionPath(raw: unknown, field = 'collection.path'): string {
    const value = requireString(raw, field, { maxLength: 4_096 });

    if (!path.isAbsolute(value)) {
        throw new ValidationError(field, 'must be an absolute path');
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
        path: (v) => parseCollectionPath(v),
        source: parseCollectionSource,
        lastOpenedAt: parseLastOpenedAt
    });
}

/** Modo e permissões dos scripts; o fingerprint nunca vem do renderer. */
export function parseScriptPolicyPatch(raw: unknown): ScriptPolicyPatch {
    const patch = requireRecord(raw, 'patch');
    const mode = requireOneOf(patch['mode'], SCRIPT_MODES, 'patch.mode');
    const rawPermissions = patch['permissions'];
    let permissions: ScriptPermissions | null = null;

    if (rawPermissions !== null && rawPermissions !== undefined) {
        const record = requireRecord(rawPermissions, 'patch.permissions');

        permissions = Object.fromEntries(SCRIPT_PERMISSIONS.map((key) => [key, requireBoolean(record[key], `patch.permissions.${key}`)])) as ScriptPermissions;
    }

    return { mode, permissions, ...(patch['retrust'] !== undefined && { retrust: requireBoolean(patch['retrust'], 'patch.retrust') }) };
}
