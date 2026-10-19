import type { EntityId, KeyValue, Timestamps } from './common';

/** Variável de ambiente; `secret` indica valor que não deve ir para o disco versionado. */
export interface EnvironmentVariable extends KeyValue {
    secret: boolean;
}

export interface Environment extends Timestamps {
    id: EntityId;
    /** `null` para ambientes globais, compartilhados entre coleções. */
    collectionId: EntityId | null;
    name: string;
    variables: EnvironmentVariable[];
}

export type NewEnvironment = Omit<Environment, 'id' | keyof Timestamps>;
