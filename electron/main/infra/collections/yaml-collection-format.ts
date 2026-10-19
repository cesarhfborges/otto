import { parse, stringify, YAMLParseError } from 'yaml';
import { COLLECTION_FORMAT_VERSION, type CollectionManifest, type KeyValue, type RequestDefinition } from '../../../shared/models';
import type { ICollectionFormat } from '../../core/contracts';
import { parseRequestDefinition, requireInteger, requireRecord, requireString } from '../../core/validation';

const MANIFEST_FILE = 'otto.yaml';
const REQUEST_EXTENSION = '.yaml';
const MAX_FILE_LENGTH = 20_000_000;

function parseYaml(content: string): unknown {
    if (content.length > MAX_FILE_LENGTH) {
        throw new Error('File is too large');
    }

    try {
        // `yaml` não executa tags customizadas; `maxAliasCount` protege contra "billion laughs".
        return parse(content, { maxAliasCount: 100, uniqueKeys: true });
    } catch (error) {
        throw new Error(error instanceof YAMLParseError ? `Invalid YAML: ${error.message.split('\n')[0]}` : String(error));
    }
}

const toYaml = (value: unknown): string => stringify(value, { lineWidth: 0, indent: 2 });

/** Só grava `enabled` quando for `false`, deixando os arquivos enxutos. */
const compactKeyValues = (items: KeyValue[]) => items.map(({ key, value, enabled }) => (enabled ? { key, value } : { key, value, enabled }));

/**
 * Formato YAML legível e amigável a diffs: chaves em ordem fixa e campos com
 * valor padrão omitidos. Uma requisição por arquivo; metadados em `otto.yaml`.
 */
export class YamlCollectionFormat implements ICollectionFormat {
    readonly manifestFile = MANIFEST_FILE;

    isRequestFile(fileName: string): boolean {
        return fileName.endsWith(REQUEST_EXTENSION) && fileName !== MANIFEST_FILE && !fileName.startsWith('.');
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
            description: manifest['description'] === undefined || manifest['description'] === null ? '' : requireString(manifest['description'], 'description', { allowEmpty: true, maxLength: 100_000 })
        };
    }

    serializeManifest(manifest: CollectionManifest): string {
        return toYaml({ version: manifest.version, name: manifest.name, ...(manifest.description ? { description: manifest.description } : {}) });
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
        } else if (body.type !== 'none') {
            document['body'] = body;
        }

        if (docs) {
            document['docs'] = docs;
        }

        return toYaml(document);
    }
}
