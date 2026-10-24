import { unzipSync, zipSync, type Zippable } from 'fflate';

export interface ZipLimits {
    /** Soma dos tamanhos descompactados (proteção contra "zip bomb"). */
    maxTotalBytes: number;
    maxEntries: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxTotalBytes: 500 * 1024 * 1024, maxEntries: 20_000 };

/** Caminho de entrada seguro: relativo, com `/`, sem `..`, sem partes vazias e sem itens ocultos. */
function safeEntryName(name: string): string | null {
    if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) {
        return null;
    }

    const segments = name.replace(/\/+$/, '').split('/');

    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
        return null;
    }

    return segments.join('/');
}

export function createZip(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
    const zippable: Zippable = {};

    for (const [name, content] of files) {
        zippable[name] = content;
    }

    return zipSync(zippable, { level: 6 });
}

/**
 * Extrai em memória. Entradas com caminho perigoso (absoluto, `..`, `\`) fazem a
 * leitura falhar (zip-slip); pastas e itens ocultos (`.git`, `.DS_Store`) são ignorados.
 */
export function readZip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Map<string, Uint8Array> {
    let total = 0;
    let count = 0;
    let unsafe: string | null = null;
    let unzipped: Record<string, Uint8Array>;

    try {
        unzipped = unzipSync(bytes, {
            filter: (file) => {
                if (file.name.endsWith('/')) {
                    return false;
                }

                const name = safeEntryName(file.name);

                if (!name) {
                    unsafe ??= file.name;

                    return false;
                }

                if (name.split('/').some((segment) => segment.startsWith('.'))) {
                    return false;
                }

                total += file.originalSize;
                count++;

                if (total > limits.maxTotalBytes || count > limits.maxEntries) {
                    throw new Error('The archive is too large to import');
                }

                return true;
            }
        });
    } catch (error) {
        if (error instanceof Error && error.message === 'The archive is too large to import') {
            throw error;
        }

        throw new Error(`Not a valid ZIP archive (${error instanceof Error ? error.message : String(error)})`);
    }

    if (unsafe) {
        throw new Error(`The archive contains an unsafe path: "${unsafe}"`);
    }

    return new Map(Object.entries(unzipped).map(([name, content]) => [safeEntryName(name)!, content]));
}
