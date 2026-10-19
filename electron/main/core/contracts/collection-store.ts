import type { CollectionTree } from '../../../shared/models';

/**
 * Acesso às coleções no sistema de arquivos (formato legível e versionável com Git).
 * Caminhos de arquivos são sempre relativos à raiz da coleção.
 */
export interface ICollectionStore {
    readTree(root: string): Promise<CollectionTree>;
    readFile(root: string, relativePath: string): Promise<string>;
    writeFile(root: string, relativePath: string, content: string): Promise<void>;
    remove(root: string, relativePath: string): Promise<void>;
}
