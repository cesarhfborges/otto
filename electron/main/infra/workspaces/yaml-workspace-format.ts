import { WORKSPACE_FORMAT_VERSION, WORKSPACE_MANIFEST_FILE, type WorkspaceManifest } from '../../../shared/models';
import type { IWorkspaceFormat } from '../../core/contracts';
import { parseEnvironmentVariables, requireArray, requireInteger, requireRecord, requireString } from '../../core/validation';
import { parseYaml, toYaml } from '../yaml';

const MAX_COLLECTIONS = 1_000;

/**
 * `workspace.yaml`: nome, lista de coleções e ambientes globais. Caminhos relativos à pasta do
 * workspace (com `/`, portáveis entre sistemas) ou absolutos.
 */
export class YamlWorkspaceFormat implements IWorkspaceFormat {
    readonly manifestFile = WORKSPACE_MANIFEST_FILE;

    parseManifest(content: string): WorkspaceManifest {
        const manifest = requireRecord(parseYaml(content) ?? {}, WORKSPACE_MANIFEST_FILE);
        const version = manifest['version'] === undefined ? 1 : requireInteger(manifest['version'], 'version', 1);

        if (version > WORKSPACE_FORMAT_VERSION) {
            throw new Error(`This workspace uses format version ${version}, which is newer than this app supports (${WORKSPACE_FORMAT_VERSION}). Please update Otto.`);
        }

        const rawCollections = manifest['collections'] === undefined || manifest['collections'] === null ? [] : requireArray(manifest['collections'], 'collections', MAX_COLLECTIONS);
        const collections = rawCollections.map((entry, i) => {
            // Aceita `- path: x` e a forma curta `- x`.
            const value = typeof entry === 'string' ? entry : requireRecord(entry, `collections[${i}]`)['path'];

            return { path: requireString(value, `collections[${i}].path`, { maxLength: 4_096 }).trim() };
        });

        const environments =
            manifest['environments'] === undefined
                ? undefined
                : (manifest['environments'] === null ? [] : requireArray(manifest['environments'], 'environments', 1_000)).map((entry, i) => {
                      const environment = requireRecord(entry, `environments[${i}]`);

                      return { name: requireString(environment['name'], `environments[${i}].name`, { maxLength: 200 }).trim(), variables: parseEnvironmentVariables(environment['variables'] ?? []) };
                  });

        return {
            version,
            name: requireString(manifest['name'], 'name', { maxLength: 200 }).trim(),
            collections,
            ...(environments ? { environments } : {})
        };
    }

    serializeManifest(manifest: WorkspaceManifest): string {
        return toYaml({
            version: manifest.version,
            name: manifest.name,
            collections: manifest.collections.map(({ path }) => ({ path })),
            ...(manifest.environments ? { environments: manifest.environments.map(({ name, variables }) => ({ name, variables: variables.map((variable) => (variable.secret ? { ...variable, value: '' } : variable)) })) } : {})
        });
    }
}
