import type { CollectionManifest, RequestDefinition } from '../../../shared/models';

/** Entrada do sistema de arquivos dentro de uma coleção. `path` é relativo à raiz e usa `/`. */
export interface CollectionEntry {
    kind: 'file' | 'directory';
    name: string;
    path: string;
    children: CollectionEntry[];
}

/**
 * Acesso ao disco confinado à raiz da coleção. Toda operação rejeita caminhos
 * que escapem da raiz (`..`, absolutos, symlinks) ou que toquem entradas ocultas (`.git`).
 */
export interface ICollectionStore {
    /** `true` se o caminho absoluto existir e for uma pasta. */
    isDirectory(absolutePath: string): Promise<boolean>;
    /** Cria a pasta raiz de uma coleção nova; falha se já existir com conteúdo. */
    createRoot(absolutePath: string): Promise<void>;
    /** Lista recursivamente, ignorando entradas ocultas, symlinks e pastas reservadas. */
    list(root: string): Promise<CollectionEntry[]>;
    exists(root: string, relativePath: string): Promise<boolean>;
    readFile(root: string, relativePath: string): Promise<string>;
    /** Escrita atômica (arquivo temporário + rename); cria as pastas intermediárias. */
    writeFile(root: string, relativePath: string, content: string, options?: { createOnly?: boolean }): Promise<void>;
    createDirectory(root: string, relativePath: string): Promise<void>;
    /** Falha se o destino já existir. */
    move(root: string, from: string, to: string): Promise<void>;
    /** Envia para a lixeira do sistema (recuperável). */
    remove(root: string, relativePath: string): Promise<void>;
}

/**
 * Formato dos arquivos da coleção (OCP: outro formato, ex. `.bru`, seria outra implementação).
 */
export interface ICollectionFormat {
    /** Nome do arquivo de manifesto na raiz (ex.: `otto.yaml`). */
    readonly manifestFile: string;
    isRequestFile(fileName: string): boolean;
    /** Nome de arquivo para uma requisição a partir de um slug (ex.: `get-users` → `get-users.yaml`). */
    requestFileName(slug: string): string;
    parseManifest(content: string): CollectionManifest;
    serializeManifest(manifest: CollectionManifest): string;
    parseRequest(content: string): RequestDefinition;
    serializeRequest(request: RequestDefinition): string;
}

/** Observa mudanças externas (git pull, editor) na pasta da coleção. */
export interface ICollectionWatcher {
    /** Retorna a função que encerra a observação. */
    watch(root: string, onChange: () => void): () => void;
}

/** Lixeira do sistema operacional. */
export interface ITrash {
    trash(absolutePath: string): Promise<void>;
}
