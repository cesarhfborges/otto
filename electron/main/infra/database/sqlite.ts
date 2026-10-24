import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

/**
 * Abre (ou cria) o banco local. Use `':memory:'` em testes.
 * WAL melhora a concorrência leitura/escrita; `foreign_keys` é desligado por padrão no SQLite.
 */
export function openDatabase(file: string): DatabaseSync {
    if (file !== ':memory:') {
        fs.mkdirSync(path.dirname(file), { recursive: true });
    }

    const db = new DatabaseSync(file);

    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');

    return db;
}

/** Executa `fn` em uma transação; faz rollback se lançar. Transações aninhadas reaproveitam a externa. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
    if (db.isTransaction) {
        return fn();
    }

    db.exec('BEGIN IMMEDIATE');

    try {
        const result = fn();

        db.exec('COMMIT');

        return result;
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}

/* O driver não aceita `boolean` nem `undefined` como parâmetro: estes helpers convertem. */

export const toSqlBool = (value: boolean): number => (value ? 1 : 0);

export const toSqlNullable = (value: string | number | null | undefined): SQLInputValue => value ?? null;

export const toSqlJson = (value: unknown): string | null => (value === null || value === undefined ? null : JSON.stringify(value));

export function fromSqlJson<T>(value: unknown, fallback: T): T {
    if (typeof value !== 'string') {
        return fallback;
    }

    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}
