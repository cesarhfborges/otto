import type { KeyValue } from './common';
import type { HttpMethod } from './http';

export const AUTH_TYPES = ['none', 'inherit', 'basic', 'bearer', 'apikey', 'wsse'] as const;

export type AuthType = (typeof AUTH_TYPES)[number];

/** `inherit` usa a autenticação definida na coleção (Etapa 8). */
export type RequestAuth =
    | { type: 'none' }
    | { type: 'inherit' }
    /** `prefix` vazio/ausente usa `Bearer`. */
    | { type: 'bearer'; token: string; prefix?: string }
    | { type: 'basic'; username: string; password: string }
    | { type: 'apikey'; key: string; value: string; in: 'header' | 'query' }
    /** WS-Security UsernameToken: o digest (nonce + data + senha) é calculado no envio. */
    | { type: 'wsse'; username: string; password: string };

export const BODY_TYPES = ['none', 'multipart-form', 'form-urlencoded', 'json', 'text', 'xml', 'binary'] as const;

export type BodyType = (typeof BODY_TYPES)[number];

/** Campo de formulário multipart: texto ou arquivo (`value` = caminho absoluto do arquivo). */
export interface MultipartField extends KeyValue {
    kind: 'text' | 'file';
}

export type RequestBody =
    | { type: 'none' }
    | { type: 'json' | 'text' | 'xml'; content: string }
    | { type: 'form-urlencoded'; fields: KeyValue[] }
    | { type: 'multipart-form'; fields: MultipartField[] }
    /** Conteúdo de um arquivo enviado como está (`file` = caminho absoluto). */
    | { type: 'binary'; file: string };

/** Conteúdo de um arquivo de requisição da coleção (antes da interpolação de variáveis). */
export interface RequestDefinition {
    name: string;
    method: HttpMethod;
    url: string;
    /** Ordem dentro da pasta; `null` ordena por nome, após os numerados. */
    seq: number | null;
    params: KeyValue[];
    headers: KeyValue[];
    auth: RequestAuth;
    body: RequestBody;
    /** Documentação em Markdown. */
    docs: string;
    /** Operação do spec OpenAPI que gerou a requisição (`MÉTODO /caminho`), usada na sincronização. */
    operation?: string;
}

export const emptyRequest = (name: string): RequestDefinition => ({
    name,
    method: 'GET',
    url: '',
    seq: null,
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: { type: 'none' },
    docs: ''
});
