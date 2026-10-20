import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CollectionEntry, ICollectionStore, ITrash } from '../../core/contracts';
import { resolveInside, toRelative } from './safe-path';

/** Pastas nunca listadas (além das ocultas, que começam com `.`). */
const IGNORED_DIRECTORIES = new Set(['node_modules']);
const MAX_DEPTH = 32;
const MAX_ENTRIES = 10_000;

const exists = async (absolute: string): Promise<boolean> => {
    try {
        await fs.lstat(absolute);

        return true;
    } catch {
        return false;
    }
};

/** Em sistemas case-insensitive, `a.yaml` e `A.yaml` são o mesmo arquivo: renomear só a caixa é permitido. */
const isSameFile = async (a: string, b: string): Promise<boolean> => {
    const [statA, statB] = await Promise.all([fs.stat(a), fs.stat(b)]);

    return statA.dev === statB.dev && statA.ino === statB.ino;
};

/** Sistema de arquivos local, confinado à raiz da coleção (ver `resolveInside`). */
export class FsCollectionStore implements ICollectionStore {
    constructor(private readonly trashBin: ITrash) {}

    async isDirectory(absolutePath: string): Promise<boolean> {
        try {
            return (await fs.stat(absolutePath)).isDirectory();
        } catch {
            return false;
        }
    }

    async createRoot(absolutePath: string): Promise<void> {
        if (!path.isAbsolute(absolutePath)) {
            throw new Error('Collection folder must be an absolute path');
        }

        if ((await exists(absolutePath)) && (await fs.readdir(absolutePath)).length > 0) {
            throw new Error(`Folder "${absolutePath}" already exists and is not empty`);
        }

        await fs.mkdir(absolutePath, { recursive: true });
    }

    async list(root: string): Promise<CollectionEntry[]> {
        let budget = MAX_ENTRIES;

        const walk = async (absolute: string, segments: string[]): Promise<CollectionEntry[]> => {
            if (segments.length > MAX_DEPTH) {
                return [];
            }

            const dirents = await fs.readdir(absolute, { withFileTypes: true });
            const entries: CollectionEntry[] = [];

            for (const dirent of dirents) {
                // Symlinks são ignorados: evitam loops e saídas da pasta da coleção.
                if (dirent.name.startsWith('.') || dirent.isSymbolicLink() || budget <= 0) {
                    continue;
                }

                const childSegments = [...segments, dirent.name];

                if (dirent.isDirectory() && !IGNORED_DIRECTORIES.has(dirent.name)) {
                    budget--;
                    entries.push({ kind: 'directory', name: dirent.name, path: toRelative(childSegments), children: await walk(path.join(absolute, dirent.name), childSegments) });
                } else if (dirent.isFile()) {
                    budget--;
                    entries.push({ kind: 'file', name: dirent.name, path: toRelative(childSegments), children: [] });
                }
            }

            return entries;
        };

        return walk(root, []);
    }

    async exists(root: string, relativePath: string): Promise<boolean> {
        return exists((await resolveInside(root, relativePath)).absolute);
    }

    async absolutePath(root: string, relativePath: string): Promise<string> {
        const { absolute } = await resolveInside(root, relativePath);

        if (!(await exists(absolute))) {
            throw new Error(`"${relativePath}" not found`);
        }

        return absolute;
    }

    async readFile(root: string, relativePath: string): Promise<string> {
        const { absolute } = await resolveInside(root, relativePath);

        return fs.readFile(absolute, 'utf-8');
    }

    async readBytes(root: string, relativePath: string): Promise<Uint8Array> {
        const { absolute } = await resolveInside(root, relativePath);

        return fs.readFile(absolute);
    }

    async writeFile(root: string, relativePath: string, content: string | Uint8Array, options: { createOnly?: boolean } = {}): Promise<void> {
        const { absolute, segments } = await resolveInside(root, relativePath);

        if (!segments.length) {
            throw new Error('Cannot write to the collection root');
        }

        if (options.createOnly && (await exists(absolute))) {
            throw new Error(`"${relativePath}" already exists`);
        }

        await fs.mkdir(path.dirname(absolute), { recursive: true });

        // Escrita atômica: nunca deixa um arquivo pela metade se o app cair no meio.
        const temporary = `${absolute}.${randomBytes(6).toString('hex')}.tmp`;

        try {
            await fs.writeFile(temporary, content, typeof content === 'string' ? { encoding: 'utf-8', flag: 'wx' } : { flag: 'wx' });
            await fs.rename(temporary, absolute);
        } catch (error) {
            await fs.rm(temporary, { force: true });
            throw error;
        }
    }

    async createDirectory(root: string, relativePath: string): Promise<void> {
        const { absolute } = await resolveInside(root, relativePath);

        if (await exists(absolute)) {
            throw new Error(`"${relativePath}" already exists`);
        }

        await fs.mkdir(absolute, { recursive: true });
    }

    async move(root: string, from: string, to: string): Promise<void> {
        const source = await resolveInside(root, from);
        const target = await resolveInside(root, to);

        if (!source.segments.length || !target.segments.length) {
            throw new Error('Cannot move the collection root');
        }

        if (!(await exists(source.absolute))) {
            throw new Error(`"${from}" does not exist`);
        }

        if ((await exists(target.absolute)) && !(await isSameFile(source.absolute, target.absolute))) {
            throw new Error(`"${to}" already exists`);
        }

        if (target.absolute.startsWith(source.absolute + path.sep)) {
            throw new Error('Cannot move a folder into itself');
        }

        await fs.mkdir(path.dirname(target.absolute), { recursive: true });
        await fs.rename(source.absolute, target.absolute);
    }

    async remove(root: string, relativePath: string): Promise<void> {
        const { absolute, segments } = await resolveInside(root, relativePath);

        if (!segments.length) {
            throw new Error('Cannot remove the collection root');
        }

        if (!(await exists(absolute))) {
            throw new Error(`"${relativePath}" does not exist`);
        }

        await this.trashBin.trash(absolute);
    }

    async removeRoot(absolutePath: string): Promise<void> {
        if (!path.isAbsolute(absolutePath)) {
            throw new Error('Collection folder must be an absolute path');
        }

        if (!(await this.isDirectory(absolutePath))) {
            throw new Error(`Folder "${absolutePath}" does not exist`);
        }

        await this.trashBin.trash(absolutePath);
    }
}
