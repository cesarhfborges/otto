import type { EntityId, Environment, EnvironmentVariable, NewEnvironment } from '../../../shared/models';
import type { IEnvironmentRepository, ISecretCipher } from '../../core/contracts';

/**
 * Decorator (OCP) do repositório de ambientes: valores de variáveis `secret` são
 * gravados cifrados e decifrados na leitura. O restante do app só vê texto puro.
 */
export class EncryptedEnvironmentRepository implements IEnvironmentRepository {
    constructor(
        private readonly inner: IEnvironmentRepository,
        private readonly cipher: ISecretCipher
    ) {}

    findById(id: EntityId): Environment | null {
        const environment = this.inner.findById(id);

        return environment && this.decrypted(environment);
    }

    findAll(): Environment[] {
        return this.inner.findAll().map((environment) => this.decrypted(environment));
    }

    findByCollection(collectionId: EntityId | null, workspaceId?: EntityId): Environment[] {
        return this.inner.findByCollection(collectionId, workspaceId).map((environment) => this.decrypted(environment));
    }

    create(input: NewEnvironment, workspaceId?: EntityId): Environment {
        return this.decrypted(this.inner.create({ ...input, variables: this.encryptVariables(input.variables) }, workspaceId));
    }

    update(id: EntityId, patch: Partial<NewEnvironment>, workspaceId?: EntityId): Environment | null {
        const updated = this.inner.update(id, patch.variables ? { ...patch, variables: this.encryptVariables(patch.variables) } : patch, workspaceId);

        return updated && this.decrypted(updated);
    }

    delete(id: EntityId): boolean {
        return this.inner.delete(id);
    }

    /** Cifra segredos gravados em texto puro (versões anteriores ou cofre antes indisponível). */
    encryptPlainSecrets(): number {
        if (this.cipher.storage === 'unavailable') {
            return 0;
        }

        let count = 0;

        for (const environment of this.inner.findAll()) {
            if (environment.variables.some((variable) => variable.secret && variable.value && !this.cipher.isEncrypted(variable.value))) {
                this.inner.update(environment.id, { variables: this.encryptVariables(environment.variables) });
                count++;
            }
        }

        return count;
    }

    private encryptVariables(variables: EnvironmentVariable[]): EnvironmentVariable[] {
        return variables.map((variable) => (variable.secret && !this.cipher.isEncrypted(variable.value) ? { ...variable, value: this.cipher.encrypt(variable.value) } : variable));
    }

    private decrypted(environment: Environment): Environment {
        return { ...environment, variables: environment.variables.map((variable) => (variable.secret ? { ...variable, value: this.cipher.decrypt(variable.value) } : variable)) };
    }
}
