/*
 * Contratos genéricos de repositório. São síncronos porque o driver SQLite
 * (`node:sqlite`) é síncrono e roda no processo main.
 */

export interface IReadRepository<T, K> {
    findById(id: K): T | null;
    findAll(): T[];
}

export interface IWriteRepository<T, K, TCreate> {
    create(input: TCreate): T;
    /** Retorna `null` quando o registro não existe. */
    update(id: K, patch: Partial<TCreate>): T | null;
    delete(id: K): boolean;
}

export interface IRepository<T, K, TCreate> extends IReadRepository<T, K>, IWriteRepository<T, K, TCreate> {}
