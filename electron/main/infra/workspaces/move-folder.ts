import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Move a pasta para `to` (cria a pasta pai). Entre discos/partições o `rename` falha
 * com `EXDEV`: copia tudo e só então apaga a origem.
 */
export async function moveFolder(from: string, to: string): Promise<void> {
    if (await fs.stat(to).then(() => true, () => false)) {
        throw Object.assign(new Error(`"${to}" already exists`), { code: 'EEXIST' });
    }

    await fs.mkdir(path.dirname(to), { recursive: true });

    try {
        await fs.rename(from, to);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
            throw error;
        }

        await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
        await fs.rm(from, { recursive: true, force: true });
    }
}
