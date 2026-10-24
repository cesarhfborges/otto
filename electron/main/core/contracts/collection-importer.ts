import type { HttpMethod, KeyValue } from '../../../shared/models';

/** Conteúdo bruto de uma especificação, já baixado ou lido do disco. */
export interface ImportSource {
    /** URL ou caminho de origem (usado para detecção por extensão e para sincronizar depois). */
    location: string;
    content: string;
    contentType?: string;
}

export interface ImportedRequest {
    /** Chave estável usada no diff local × remoto (ex.: `GET /users/{id}`). */
    key: string;
    name: string;
    folder: string[];
    method: HttpMethod;
    url: string;
    headers: KeyValue[];
    query: KeyValue[];
    body?: { mediaType: string; content: string };
}

export interface ImportedCollection {
    name: string;
    version: string | null;
    description: string | null;
    baseUrl: string | null;
    requests: ImportedRequest[];
}

/**
 * Importador de um formato de coleção (OpenAPI, Postman, Insomnia...).
 * Novos formatos são adicionados registrando novas implementações (OCP).
 */
export interface ICollectionImporter {
    readonly id: string;
    readonly label: string;
    canImport(source: ImportSource): boolean;
    import(source: ImportSource): Promise<ImportedCollection>;
}
