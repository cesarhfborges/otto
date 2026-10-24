/** Fonte de data/hora injetável (facilita testes determinísticos). */
export interface IClock {
    /** Data/hora atual em ISO 8601 (UTC). */
    now(): string;
}

export interface IIdGenerator {
    next(): string;
}
