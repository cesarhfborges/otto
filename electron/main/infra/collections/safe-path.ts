import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export class UnsafePathError extends Error {
    constructor(relativePath: string, reason: string) {
        super(`Unsafe path "${relativePath}": ${reason}`);
        this.name = 'UnsafePathError';
    }
}

/**
 * Normaliza um caminho relativo da coleção (`a/b/c.yaml`) em segmentos.
 * Rejeita absolutos, `..`, barras invertidas, NUL e segmentos ocultos (protege `.git`).
 * `''` representa a própria raiz.
 */
export function toSegments(relativePath: string): string[] {
    if (relativePath.includes('\0')) {
        throw new UnsafePathError(relativePath, 'contains NUL');
    }

    if (relativePath.includes('\\')) {
        throw new UnsafePathError(relativePath, 'use "/" as separator');
    }

    if (relativePath.startsWith('/') || /^[a-zA-Z]:/.test(relativePath)) {
        throw new UnsafePathError(relativePath, 'must be relative');
    }

    const segments = relativePath.split('/').filter((s) => s !== '' && s !== '.');

    for (const segment of segments) {
        if (segment === '..') {
            throw new UnsafePathError(relativePath, 'must not leave the collection folder');
        }

        if (segment.startsWith('.')) {
            throw new UnsafePathError(relativePath, 'hidden files and folders are not allowed');
        }
    }

    return segments;
}

/** Caminho relativo canônico (`a/b`), usado nas respostas ao renderer. */
export const toRelative = (segments: readonly string[]): string => segments.join('/');

async function realpathOfDeepestExisting(target: string): Promise<{ real: string; rest: string[] }> {
    const rest: string[] = [];
    let current = target;

    for (;;) {
        try {
            return { real: await fs.realpath(current), rest };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }

            const parent = path.dirname(current);

            if (parent === current) {
                throw error;
            }

            rest.unshift(path.basename(current));
            current = parent;
        }
    }
}

/**
 * Resolve `relativePath` dentro de `root` e garante que o destino (inclusive
 * seguindo symlinks já existentes) continua dentro da raiz real da coleção.
 */
export async function resolveInside(root: string, relativePath: string): Promise<{ absolute: string; segments: string[] }> {
    const segments = toSegments(relativePath);
    const absolute = path.join(root, ...segments);
    const realRoot = await fs.realpath(root);
    const { real, rest } = await realpathOfDeepestExisting(absolute);
    const resolved = path.join(real, ...rest);

    if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) {
        throw new UnsafePathError(relativePath, 'resolves outside the collection folder');
    }

    return { absolute, segments };
}
