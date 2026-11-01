import type { DatabaseSync } from 'node:sqlite';
import { defaultScriptPermissions, SCRIPT_PERMISSIONS, type CollectionMetadata, type CollectionSource, type EntityId, type NewCollectionMetadata, type ScriptMode, type ScriptPermissions } from '../../../shared/models';
import type { IClock, ICollectionMetadataRepository, IIdGenerator } from '../../core/contracts';
import { fromSqlJson, toSqlJson, toSqlNullable } from '../database/sqlite';

interface CollectionRow {
    id: string;
    name: string;
    path: string;
    source: string | null;
    last_opened_at: string | null;
    script_mode: ScriptMode;
    script_permissions: string | null;
    trusted_fingerprint: string | null;
    trusted_at: string | null;
    created_at: string;
    updated_at: string;
}

/** Permissões gravadas (JSON) sobre o padrão do modo; chaves desconhecidas ou inválidas são ignoradas. */
function permissionsOf(mode: ScriptMode, raw: string | null): { permissions: ScriptPermissions; custom: boolean } {
    const stored = fromSqlJson<Record<string, unknown> | null>(raw, null);
    const permissions = defaultScriptPermissions(mode);

    if (!stored || typeof stored !== 'object') {
        return { permissions, custom: false };
    }

    for (const key of SCRIPT_PERMISSIONS) {
        if (typeof stored[key] === 'boolean') {
            permissions[key] = stored[key];
        }
    }

    return { permissions, custom: true };
}

const toCollection = (row: CollectionRow): CollectionMetadata => {
    const { permissions, custom } = permissionsOf(row.script_mode, row.script_permissions);

    return {
        id: row.id,
        name: row.name,
        path: row.path,
        source: fromSqlJson<CollectionSource | null>(row.source, null),
        lastOpenedAt: row.last_opened_at,
        scriptPolicy: { mode: row.script_mode, permissions, customPermissions: custom, trustedFingerprint: row.trusted_fingerprint, trustedAt: row.trusted_at },
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
};

export class SqliteCollectionMetadataRepository implements ICollectionMetadataRepository {
    constructor(
        private readonly db: DatabaseSync,
        private readonly clock: IClock,
        private readonly ids: IIdGenerator
    ) {}

    findById(id: EntityId): CollectionMetadata | null {
        const row = this.db.prepare('SELECT * FROM collections_metadata WHERE id = ?').get(id) as CollectionRow | undefined;

        return row ? toCollection(row) : null;
    }

    findByPath(path: string): CollectionMetadata | null {
        const row = this.db.prepare('SELECT * FROM collections_metadata WHERE path = ?').get(path) as CollectionRow | undefined;

        return row ? toCollection(row) : null;
    }

    /** Ordena pelas abertas mais recentemente. */
    findAll(): CollectionMetadata[] {
        const rows = this.db.prepare('SELECT * FROM collections_metadata ORDER BY last_opened_at IS NULL, last_opened_at DESC, name COLLATE NOCASE').all() as unknown as CollectionRow[];

        return rows.map(toCollection);
    }

    create(input: NewCollectionMetadata): CollectionMetadata {
        if (this.findByPath(input.path)) {
            throw new Error(`A collection is already registered at "${input.path}"`);
        }

        const now = this.clock.now();
        const id = this.ids.next();

        // `scripts_trusted` é legado (migração 006): o modo vale.
        this.db
            .prepare('INSERT INTO collections_metadata (id, name, path, source, last_opened_at, script_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(id, input.name, input.path, toSqlJson(input.source), toSqlNullable(input.lastOpenedAt), input.scriptMode ?? 'ask', now, now);

        return this.findById(id)!;
    }

    update(id: EntityId, patch: Partial<NewCollectionMetadata>): CollectionMetadata | null {
        const current = this.findById(id);

        if (!current) {
            return null;
        }

        const updated = { ...current, ...patch, id, updatedAt: this.clock.now() };
        const owner = updated.path !== current.path ? this.findByPath(updated.path) : null;

        if (owner) {
            throw new Error(`A collection is already registered at "${updated.path}"`);
        }

        this.db
            .prepare('UPDATE collections_metadata SET name = ?, path = ?, source = ?, last_opened_at = ?, updated_at = ? WHERE id = ?')
            .run(updated.name, updated.path, toSqlJson(updated.source), toSqlNullable(updated.lastOpenedAt), updated.updatedAt, id);

        return this.findById(id);
    }

    setScriptPolicy(id: EntityId, policy: { mode: ScriptMode; permissions: ScriptPermissions | null; trustedFingerprint: string | null; trustedAt: string | null }): CollectionMetadata | null {
        const changes = this.db
            .prepare('UPDATE collections_metadata SET script_mode = ?, script_permissions = ?, trusted_fingerprint = ?, trusted_at = ?, updated_at = ? WHERE id = ?')
            .run(policy.mode, toSqlJson(policy.permissions), toSqlNullable(policy.trustedFingerprint), toSqlNullable(policy.trustedAt), this.clock.now(), id).changes;

        return Number(changes) > 0 ? this.findById(id) : null;
    }

    delete(id: EntityId): boolean {
        return Number(this.db.prepare('DELETE FROM collections_metadata WHERE id = ?').run(id).changes) > 0;
    }
}
