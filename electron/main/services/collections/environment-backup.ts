import type { EntityId, Environment, NewEnvironment } from '../../../shared/models';
import type { IEnvironmentRepository } from '../../core/contracts';
import { parseEnvironmentVariables, requireArray, requireRecord, requireString } from '../../core/validation';

/**
 * Ambientes ficam no banco (não na pasta da coleção). Nos backups do Otto eles vão
 * neste arquivo, na raiz da coleção (ou do workspace, para os globais), e são
 * recriados na importação — o arquivo não é gravado no disco.
 */
export const ENVIRONMENTS_BACKUP_FILE = 'otto-environments.json';

interface EnvironmentsBackup {
    version: 1;
    environments: Array<Pick<Environment, 'name' | 'variables'>>;
}

export function serializeEnvironments(environments: Environment[]): Uint8Array {
    // Cofre: segredos não saem da máquina; a variável vai vazia para ser preenchida no destino.
    const backup: EnvironmentsBackup = {
        version: 1,
        environments: environments.map(({ name, variables }) => ({ name, variables: variables.map((variable) => (variable.secret ? { ...variable, value: '' } : variable)) }))
    };

    return new TextEncoder().encode(`${JSON.stringify(backup, null, 2)}\n`);
}

/** Recria os ambientes do backup ligados a `collectionId` (`null` = globais do workspace). */
export function restoreEnvironments(content: Uint8Array, repository: IEnvironmentRepository, collectionId: EntityId | null, workspaceId?: EntityId): void {
    const raw = requireRecord(JSON.parse(new TextDecoder().decode(content)), 'environments backup');

    requireArray(raw['environments'], 'environments', 1_000).forEach((item, i) => {
        const environment = requireRecord(item, `environments[${i}]`);
        const input: NewEnvironment = {
            collectionId,
            name: requireString(environment['name'], `environments[${i}].name`, { maxLength: 200 }),
            variables: parseEnvironmentVariables(environment['variables'])
        };

        repository.create(input, workspaceId);
    });
}
