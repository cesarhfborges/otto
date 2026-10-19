import type { DatabaseSync } from 'node:sqlite';
import type { EntityId, HistoryEntry, HistoryQuery, HttpMethod, NewHistoryEntry } from '../../../shared/models';
import type { IClock, IHistoryRepository, IIdGenerator } from '../../core/contracts';
import { toSqlNullable } from '../database/sqlite';

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

    add(entry: NewHistoryEntry): HistoryEntry {
        const created: HistoryEntry = { ...entry, id: this.ids.next(), executedAt: this.clock.now() };

        this.db
            .prepare(
                `INSERT INTO history (id, collection_id, request_path, method, url, status, error, time_ms, size_bytes, executed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(created.id, toSqlNullable(created.collectionId), toSqlNullable(created.requestPath), created.method, created.url, toSqlNullable(created.status), toSqlNullable(created.error), created.timeMs, created.sizeBytes, created.executedAt);

        return created;
    }

    list(query: HistoryQuery = {}): HistoryEntry[] {
        const limit = Math.min(Math.max(1, query.limit ?? HISTORY_DEFAULT_LIMIT), HISTORY_MAX_LIMIT);
        const offset = Math.max(0, query.offset ?? 0);
        const where = query.collectionId ? 'WHERE collection_id = ?' : '';
        const params = query.collectionId ? [query.collectionId, limit, offset] : [limit, offset];
        const rows = this.db.prepare(`SELECT * FROM history ${where} ORDER BY executed_at DESC, rowid DESC LIMIT ? OFFSET ?`).all(...params) as unknown as HistoryRow[];

        return rows.map(toEntry);
    }

    delete(id: EntityId): boolean {
        return Number(this.db.prepare('DELETE FROM history WHERE id = ?').run(id).changes) > 0;
    }

    clear(): number {
        return Number(this.db.prepare('DELETE FROM history').run().changes);
    }
}
