import type { EntityId } from './common';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'TRACE', 'CONNECT'] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Métodos que não levam corpo: a aba Body fica oculta e nada é enviado. */
export const METHODS_WITHOUT_BODY: readonly HttpMethod[] = ['GET', 'HEAD', 'TRACE', 'CONNECT'];

export const hasBody = (method: HttpMethod): boolean => !METHODS_WITHOUT_BODY.includes(method);

/** Parte de um corpo multipart já interpolada; arquivos são lidos pelo main no envio. */
export interface HttpMultipartPart {
    name: string;
    value: string;
    file: boolean;
}

/** Corpos maiores são truncados (evita estourar a memória do main e do renderer). */
export const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

/** Arquivo da coleção que originou a requisição (vai para o histórico). */
export interface HttpRequestSource {
    collectionId: EntityId;
    requestPath: string;
}

/** Requisição já interpolada, pronta para ser executada pelo processo main. */
export interface HttpRequest {
    /** Identificador gerado pelo renderer, usado para cancelar a requisição. */
    id: string;
    method: HttpMethod;
    url: string;
    headers?: Record<string, string>;
    /** Corpo em texto. Alternativas (exclusivas): `bodyFile` e `multipart`. */
    body?: string;
    /** Caminho absoluto de um arquivo enviado como corpo (File/Binary). */
    bodyFile?: string;
    multipart?: HttpMultipartPart[];
    /** Credenciais WSSE: o main gera `X-WSSE` (nonce, data e digest) no momento do envio. */
    wsse?: { username: string; password: string };
    timeoutMs?: number;
    source?: HttpRequestSource;
}

/** Tempos em milissegundos, medidos no processo main. */
export interface HttpTimings {
    /** Do envio até receber os headers da resposta (inclui DNS, conexão, TLS e proxy). */
    ttfbMs: number;
    /** Download do corpo. */
    downloadMs: number;
    totalMs: number;
}

export interface HttpResponse {
    /** URL final (após redirecionamentos). */
    url: string;
    redirected: boolean;
    status: number;
    statusText: string;
    headers: Array<[string, string]>;
    contentType: string | null;
    /** Corpo como texto (`utf8`) ou, para conteúdo binário (imagens, PDF...), em `base64`. */
    body: string;
    bodyEncoding: 'utf8' | 'base64';
    /** Tamanho do corpo em bytes (após descompressão). */
    size: number;
    /** Tamanho aproximado da linha de status + headers, em bytes. */
    headersSize: number;
    /** O corpo passou de `MAX_RESPONSE_BYTES` e foi cortado. */
    truncated: boolean;
    /** Tempo total, igual a `timings.totalMs`. */
    timeMs: number;
    timings: HttpTimings;
}

/**
 * Linha do console da execução, no estilo do `curl -v`:
 * `info` (`*`), headers enviados (`>`), corpo enviado (`|`), headers recebidos (`<`) e erro.
 */
export interface HttpTimelineEntry {
    kind: 'info' | 'request-header' | 'request-body' | 'response-header' | 'error';
    text: string;
}

export type HttpResult =
    | { ok: true; response: HttpResponse; timeline: HttpTimelineEntry[] }
    | {
          ok: false;
          error: string;
          /** Código do erro (`ECONNREFUSED`, `ENOTFOUND`, `UNSUPPORTED_PROTOCOL`...), usado para sugerir soluções. */
          code?: string;
          timeMs: number;
          timeline: HttpTimelineEntry[];
      };
