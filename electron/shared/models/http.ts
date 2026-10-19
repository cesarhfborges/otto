export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Requisição já interpolada, pronta para ser executada pelo processo main. */
export interface HttpRequest {
    /** Identificador gerado pelo renderer, usado para cancelar a requisição. */
    id: string;
    method: HttpMethod;
    url: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
}

export interface HttpResponse {
    url: string;
    status: number;
    statusText: string;
    headers: Array<[string, string]>;
    body: string;
    /** Tamanho do corpo em bytes. */
    size: number;
    /** Tempo total (até o fim do download do corpo) em milissegundos. */
    timeMs: number;
}

export type HttpResult = { ok: true; response: HttpResponse } | { ok: false; error: string; timeMs: number };
