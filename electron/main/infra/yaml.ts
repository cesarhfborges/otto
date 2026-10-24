import { parse, stringify, YAMLParseError } from 'yaml';

/** Arquivos de coleção e de workspace maiores que isso são recusados. */
const MAX_FILE_LENGTH = 20_000_000;

export function parseYaml(content: string): unknown {
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

export const toYaml = (value: unknown): string => stringify(value, { lineWidth: 0, indent: 2 });
