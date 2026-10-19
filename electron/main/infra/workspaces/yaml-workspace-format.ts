import { WORKSPACE_FORMAT_VERSION, WORKSPACE_MANIFEST_FILE, type WorkspaceManifest } from '../../../shared/models';
import type { IWorkspaceFormat } from '../../core/contracts';
import { requireArray, requireInteger, requireRecord, requireString } from '../../core/validation';
import { parseYaml, toYaml } from '../yaml';

const MAX_COLLECTIONS = 1_000;

/**
 * `workspace.yaml`: nome e lista de coleções. Caminhos relativos à pasta do
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

        return {
            version,
            name: requireString(manifest['name'], 'name', { maxLength: 200 }).trim(),
            collections
        };
    }

    serializeManifest(manifest: WorkspaceManifest): string {
        return toYaml({ version: manifest.version, name: manifest.name, collections: manifest.collections.map(({ path }) => ({ path })) });
    }
}
