import type { EnvironmentVariable, NewEnvironment } from '../../../shared/models';
import { parseNullableEntityId, pickDefined, requireArray, requireBoolean, requireRecord, requireString } from './guards';

export const MAX_VARIABLES = 1_000;

export function parseEnvironmentVariables(raw: unknown): EnvironmentVariable[] {
    return requireArray(raw, 'variables', MAX_VARIABLES).map((item, i) => {
        const variable = requireRecord(item, `variables[${i}]`);

        return {
            key: requireString(variable['key'], `variables[${i}].key`, { allowEmpty: true, maxLength: 500 }),
            value: requireString(variable['value'], `variables[${i}].value`, { allowEmpty: true, maxLength: 100_000 }),
            enabled: variable['enabled'] === undefined ? true : requireBoolean(variable['enabled'], `variables[${i}].enabled`),
            secret: variable['secret'] === undefined ? false : requireBoolean(variable['secret'], `variables[${i}].secret`)
        };
    });
}

const parseName = (raw: unknown): string => requireString(raw, 'environment.name', { maxLength: 200 }).trim();

export function parseNewEnvironment(raw: unknown): NewEnvironment {
    const input = requireRecord(raw, 'environment');

    return {
        collectionId: parseNullableEntityId(input['collectionId'], 'environment.collectionId'),
        name: parseName(input['name']),
        variables: input['variables'] === undefined ? [] : parseEnvironmentVariables(input['variables'])
    };
}

export function parseEnvironmentPatch(raw: unknown): Partial<NewEnvironment> {
    return pickDefined<NewEnvironment>(requireRecord(raw, 'patch'), {
        collectionId: (v) => parseNullableEntityId(v, 'patch.collectionId'),
        name: parseName,
        variables: parseEnvironmentVariables
    });
}
