import type { DatabaseSync } from 'node:sqlite';
import type { EntityId, HistoryDetail, HistoryEntry, HistoryEntryWithDetail, HistoryQuery, HistoryScope, HttpMethod, NewHistoryEntry } from '../../../shared/models';
import type { IClock, IHistoryRepository, IIdGenerator } from '../../core/contracts';
import { fromSqlJson, toSqlNullable } from '../database/sqlite';

export const HISTORY_DEFAULT_LIMIT = 100;
export const HISTORY_MAX_LIMIT = 1000;

interface HistoryRow {
    id: string;
    collection_id: string | null;
    request_path: string | null;
    method: string;
    url: string;
    status: number | null;
    error: string | null;
    time_ms: number;
    size_bytes: number;
    executed_at: string;
    detail: string | null;
}

const toEntry = (row: HistoryRow): HistoryEntry => ({
    id: row.id,
    collectionId: row.collection_id,
    requestPath: row.request_path,
    method: row.method as HttpMethod,
    url: row.url,
    status: row.status,
    error: row.error,
    timeMs: row.time_ms,
    sizeBytes: row.size_bytes,
    executedAt: row.executed_at
});

export class SqliteHistoryRepository implements IHistoryRepository {
    constructor(
        private readonly db: DatabaseSync,
        private readonly clock: IClock,
        private readonly ids: IIdGenerator
    ) {}

    add({ detail, ...entry }: NewHistoryEntry): HistoryEntry {
        const created: HistoryEntry = { ...entry, id: this.ids.next(), executedAt: this.clock.now() };

        this.db
            .prepare(
                `INSERT INTO history (id, collection_id, request_path, method, url, status, error, time_ms, size_bytes, executed_at, detail)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                created.id,
                toSqlNullable(created.collectionId),
                toSqlNullable(created.requestPath),
                created.method,
                created.url,
                toSqlNullable(created.status),
                toSqlNullable(created.error),
                created.timeMs,
                created.sizeBytes,
                created.executedAt,
                detail ? JSON.stringify(detail) : null
            );

        return created;
    }

    list(query: HistoryQuery = {}): HistoryEntry[] {
        const limit = Math.min(Math.max(1, query.limit ?? HISTORY_DEFAULT_LIMIT), HISTORY_MAX_LIMIT);
        const offset = Math.max(0, query.offset ?? 0);
        const conditions: string[] = [];
        const params: Array<string | number> = [];

        if (query.collectionId) {
            conditions.push('collection_id = ?');
            params.push(query.collectionId);

            if (query.requestPath !== undefined) {
                conditions.push('request_path = ?');
                params.push(query.requestPath);
            }
        }

        params.push(limit, offset);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        // O detalhe (corpos) só é lido em `get`.
        const rows = this.db
            .prepare(`SELECT id, collection_id, request_path, method, url, status, error, time_ms, size_bytes, executed_at, NULL AS detail FROM history ${where} ORDER BY executed_at DESC, rowid DESC LIMIT ? OFFSET ?`)
            .all(...params) as unknown as HistoryRow[];

        return rows.map(toEntry);
    }

    get(id: EntityId): HistoryEntryWithDetail | null {
        const row = this.db.prepare('SELECT * FROM history WHERE id = ?').get(id) as HistoryRow | undefined;

        return row ? { ...toEntry(row), detail: row.detail ? fromSqlJson<HistoryDetail | null>(row.detail, null) : null } : null;
    }

    delete(id: EntityId): boolean {
        return Number(this.db.prepare('DELETE FROM history WHERE id = ?').run(id).changes) > 0;
    }

    clear(scope: HistoryScope = {}): number {
        if (!scope.collectionId) {
            return Number(this.db.prepare('DELETE FROM history').run().changes);
        }

        if (scope.requestPath === undefined) {
            return Number(this.db.prepare('DELETE FROM history WHERE collection_id = ?').run(scope.collectionId).changes);
        }

        return Number(this.db.prepare('DELETE FROM history WHERE collection_id = ? AND request_path = ?').run(scope.collectionId, scope.requestPath).changes);
    }

    prune(keep: number): number {
        const offset = Math.max(0, Math.trunc(keep));

        return Number(this.db.prepare('DELETE FROM history WHERE rowid IN (SELECT rowid FROM history ORDER BY executed_at DESC, rowid DESC LIMIT -1 OFFSET ?)').run(offset).changes);
    }
}
