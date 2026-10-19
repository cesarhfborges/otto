/*
 * Tudo que chega pelo IPC vem do renderer e é tratado como não confiável:
 * estes guards convertem `unknown` nos tipos do contrato ou lançam `ValidationError`.
 */

export class ValidationError extends Error {
    constructor(field: string, message: string) {
        super(`Invalid "${field}": ${message}`);
        this.name = 'ValidationError';
    }
}

export const MAX_ID_LENGTH = 200;
export const MAX_TEXT_LENGTH = 10_000;

export const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function requireRecord(value: unknown, field: string): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new ValidationError(field, 'expected an object');
    }

    return value;
}

export function requireString(value: unknown, field: string, { allowEmpty = false, maxLength = MAX_TEXT_LENGTH } = {}): string {
    if (typeof value !== 'string') {
        throw new ValidationError(field, 'expected a string');
    }

    if (!allowEmpty && !value.trim()) {
        throw new ValidationError(field, 'must not be empty');
    }

    if (value.length > maxLength) {
        throw new ValidationError(field, `must have at most ${maxLength} characters`);
    }

    return value;
}

export function optionalString(value: unknown, field: string, options?: { allowEmpty?: boolean; maxLength?: number }): string | null {
    return value === null || value === undefined ? null : requireString(value, field, options);
}

export function requireBoolean(value: unknown, field: string): boolean {
    if (typeof value !== 'boolean') {
        throw new ValidationError(field, 'expected a boolean');
    }

    return value;
}

export function requireInteger(value: unknown, field: string, min = Number.MIN_SAFE_INTEGER): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
        throw new ValidationError(field, `expected an integer >= ${min}`);
    }

    return value;
}

export function requireArray(value: unknown, field: string, maxItems: number): unknown[] {
    if (!Array.isArray(value)) {
        throw new ValidationError(field, 'expected an array');
    }

    if (value.length > maxItems) {
        throw new ValidationError(field, `must have at most ${maxItems} items`);
    }

    return value;
}

export function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    if (!allowed.includes(value as T)) {
        throw new ValidationError(field, `expected one of ${allowed.join(', ')}`);
    }

    return value as T;
}

export const parseEntityId = (raw: unknown, field = 'id'): string => requireString(raw, field, { maxLength: MAX_ID_LENGTH });

export const parseNullableEntityId = (raw: unknown, field = 'id'): string | null => (raw === null || raw === undefined ? null : parseEntityId(raw, field));

/** Copia para `target` apenas as chaves presentes em `source`, aplicando o parser de cada uma. */
export function pickDefined<T extends object>(source: Record<string, unknown>, parsers: { [K in keyof T]?: (value: unknown) => T[K] }): Partial<T> {
    const result: Partial<T> = {};

    for (const key of Object.keys(parsers) as Array<keyof T>) {
        if (source[key as string] !== undefined) {
            result[key] = parsers[key]!(source[key as string]);
        }
    }

    return result;
}
