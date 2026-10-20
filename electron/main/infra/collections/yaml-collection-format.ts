import { COLLECTION_FORMAT_VERSION, type CollectionManifest, type KeyValue, type RequestDefinition } from '../../../shared/models';
import type { FolderMetadata, ICollectionFormat } from '../../core/contracts';
import { parseKeyValues, parseOpenApiConfig, parseRequestDefinition, requireInteger, requireRecord, requireString } from '../../core/validation';
import { parseYaml, toYaml } from '../yaml';

const MANIFEST_FILE = 'otto.yaml';
const REQUEST_EXTENSION = '.yaml';
/** Começa com `_`, que o `slugify` nunca gera: não colide com arquivos de requisição criados pelo app. */
const FOLDER_FILE = '_folder.yaml';

/** Só grava `enabled` quando for `false`, deixando os arquivos enxutos. */
const compactKeyValues = (items: KeyValue[]) => items.map(({ key, value, enabled, description }) => ({ key, value, ...(!enabled && { enabled }), ...(description && { description }) }));

/**
 * Formato YAML legível e amigável a diffs: chaves em ordem fixa e campos com
 * valor padrão omitidos. Uma requisição por arquivo; metadados em `otto.yaml`.
 */
export class YamlCollectionFormat implements ICollectionFormat {
    readonly manifestFile = MANIFEST_FILE;
    readonly folderFile = FOLDER_FILE;

    isRequestFile(fileName: string): boolean {
        return fileName.endsWith(REQUEST_EXTENSION) && fileName !== MANIFEST_FILE && fileName !== FOLDER_FILE && !fileName.startsWith('.');
    }

    parseFolder(content: string): FolderMetadata {
        const folder = requireRecord(parseYaml(content) ?? {}, FOLDER_FILE);

        return { seq: folder['seq'] === undefined || folder['seq'] === null ? null : requireInteger(folder['seq'], 'seq', 0) };
    }

    serializeFolder(folder: FolderMetadata): string {
        return toYaml(folder.seq === null ? {} : { seq: folder.seq });
    }

    requestFileName(slug: string): string {
        return `${slug}${REQUEST_EXTENSION}`;
    }

    parseManifest(content: string): CollectionManifest {
        const manifest = requireRecord(parseYaml(content) ?? {}, MANIFEST_FILE);
        const version = manifest['version'] === undefined ? 1 : requireInteger(manifest['version'], 'version', 1);

        if (version > COLLECTION_FORMAT_VERSION) {
            throw new Error(`This collection uses format version ${version}, which is newer than this app supports (${COLLECTION_FORMAT_VERSION}). Please update Otto.`);
        }

        return {
            version,
            name: requireString(manifest['name'], 'name', { maxLength: 200 }).trim(),
            description: manifest['description'] === undefined || manifest['description'] === null ? '' : requireString(manifest['description'], 'description', { allowEmpty: true, maxLength: 100_000 }),
            headers: parseKeyValues(manifest['headers'], 'headers'),
            openapi: manifest['openapi'] === undefined || manifest['openapi'] === null ? null : parseOpenApiConfig(manifest['openapi'])
        };
    }

    serializeManifest(manifest: CollectionManifest): string {
        return toYaml({
            version: manifest.version,
            name: manifest.name,
            ...(manifest.description ? { description: manifest.description } : {}),
            ...(manifest.headers.length ? { headers: compactKeyValues(manifest.headers) } : {}),
            ...(manifest.openapi ? { openapi: manifest.openapi } : {})
        });
    }

    parseRequest(content: string): RequestDefinition {
        return parseRequestDefinition(parseYaml(content));
    }

    serializeRequest(request: RequestDefinition): string {
        const { name, method, url, seq, params, headers, auth, body, docs } = request;
        const document: Record<string, unknown> = { name, method, url };

        if (seq !== null) {
            document['seq'] = seq;
        }

        if (params.length) {
            document['params'] = compactKeyValues(params);
        }

        if (headers.length) {
            document['headers'] = compactKeyValues(headers);
        }

        if (auth.type !== 'none') {
            document['auth'] = auth;
        }

        if (body.type === 'form-urlencoded') {
            document['body'] = { type: body.type, fields: compactKeyValues(body.fields) };
        } else if (body.type === 'multipart-form') {
            // `kind` só é gravado para arquivos (texto é o padrão).
            document['body'] = { type: body.type, fields: body.fields.map((field) => ({ ...compactKeyValues([field])[0], ...(field.kind === 'file' && { kind: 'file' }) })) };
        } else if (body.type !== 'none') {
            document['body'] = body;
        }

        if (request.operation) {
            document['operation'] = request.operation;
        }

        if (docs) {
            document['docs'] = docs;
        }

        return toYaml(document);
    }
}
