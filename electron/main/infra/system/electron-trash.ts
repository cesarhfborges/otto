import { shell } from 'electron';
import type { ITrash } from '../../core/contracts';

/** Lixeira nativa: exclusões feitas pelo app podem ser desfeitas pelo sistema operacional. */
export const electronTrash: ITrash = {
    trash: (absolutePath) => shell.trashItem(absolutePath)
};
