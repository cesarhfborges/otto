import type { KeyValue } from './common';
import type { HttpMethod } from './http';

export const AUTH_TYPES = ['none', 'inherit', 'bearer', 'basic', 'apikey'] as const;

export type AuthType = (typeof AUTH_TYPES)[number];

/** `inherit` usa a autenticação definida na coleção (Etapa 8). */
export type RequestAuth = { type: 'none' } | { type: 'inherit' } | { type: 'bearer'; token: string } | { type: 'basic'; username: string; password: string } | { type: 'apikey'; key: string; value: string; in: 'header' | 'query' };

export const BODY_TYPES = ['none', 'json', 'text', 'xml', 'form-urlencoded'] as const;

export type BodyType = (typeof BODY_TYPES)[number];

export type RequestBody = { type: 'none' } | { type: 'json' | 'text' | 'xml'; content: string } | { type: 'form-urlencoded'; fields: KeyValue[] };

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
