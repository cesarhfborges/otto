import type { KeyValue } from './common';
import type { HttpMethod } from './http';

export const AUTH_TYPES = ['none', 'inherit', 'basic', 'bearer', 'apikey', 'wsse', 'digest', 'ntlm', 'oauth1', 'oauth2', 'awsv4', 'hawk', 'asap', 'netrc'] as const;

export type AuthType = (typeof AUTH_TYPES)[number];

export const OAUTH1_SIGNATURE_METHODS = ['HMAC-SHA1', 'HMAC-SHA256', 'HMAC-SHA512', 'RSA-SHA1', 'RSA-SHA256', 'RSA-SHA512', 'PLAINTEXT'] as const;

export type OAuth1SignatureMethod = (typeof OAUTH1_SIGNATURE_METHODS)[number];

export const OAUTH2_GRANT_TYPES = ['authorization_code', 'implicit', 'client_credentials', 'password'] as const;

export type OAuth2GrantType = (typeof OAUTH2_GRANT_TYPES)[number];

export const HAWK_ALGORITHMS = ['sha256', 'sha1'] as const;

export type HawkAlgorithm = (typeof HAWK_ALGORITHMS)[number];

/** `inherit` usa a autenticação definida na coleção (Etapa 8). */
export type RequestAuth =
    | { type: 'none' }
    | { type: 'inherit' }
    /** `prefix` vazio/ausente usa `Bearer`. */
    | { type: 'bearer'; token: string; prefix?: string }
    | { type: 'basic'; username: string; password: string }
    | { type: 'apikey'; key: string; value: string; in: 'header' | 'query' }
    /** WS-Security UsernameToken: o digest (nonce + data + senha) é calculado no envio. */
    | { type: 'wsse'; username: string; password: string }
    /** Responde ao desafio `WWW-Authenticate: Digest` do servidor (reenvio automático). */
    | { type: 'digest'; username: string; password: string }
    /** NTLMv2 (handshake de 3 etapas na mesma conexão; não passa pelo proxy). */
    | { type: 'ntlm'; username: string; password: string; domain: string; workstation: string }
    /** `privateKey` (PEM) só é usada nos métodos RSA. */
    | {
          type: 'oauth1';
          signatureMethod: OAuth1SignatureMethod;
          consumerKey: string;
          consumerSecret: string;
          token: string;
          tokenSecret: string;
          privateKey: string;
          realm: string;
          addTo: 'header' | 'query';
      }
    /** O token obtido fica só em memória (por configuração) e é renovado quando expira. */
    | {
          type: 'oauth2';
          grantType: OAuth2GrantType;
          authUrl: string;
          accessTokenUrl: string;
          callbackUrl: string;
          clientId: string;
          clientSecret: string;
          username: string;
          password: string;
          scope: string;
          pkce: boolean;
          /** Credenciais do cliente no header Basic ou no corpo da requisição de token. */
          clientAuth: 'header' | 'body';
          /** Vazio usa `Bearer`. */
          tokenPrefix: string;
          addTo: 'header' | 'query';
      }
    /** AWS Signature Version 4. */
    | { type: 'awsv4'; accessKeyId: string; secretAccessKey: string; sessionToken: string; region: string; service: string }
    | { type: 'hawk'; id: string; key: string; algorithm: HawkAlgorithm; ext: string }
    /** Atlassian ASAP: JWT RS256 assinado com a chave privada (PEM ou data URI). `expiresIn` em segundos. */
    | { type: 'asap'; issuer: string; audience: string; subject: string; keyId: string; privateKey: string; expiresIn: string }
    /** Credenciais do `~/.netrc` (ou `$NETRC`) para o host da URL, enviadas como Basic. */
    | { type: 'netrc' };

/** Autenticações calculadas pelo main no envio (nonce, horário, desafio do servidor, token…). */
export const SEND_TIME_AUTH_TYPES = ['wsse', 'digest', 'ntlm', 'oauth1', 'oauth2', 'awsv4', 'hawk', 'asap', 'netrc'] as const satisfies readonly AuthType[];

export type SendTimeAuth = Extract<RequestAuth, { type: (typeof SEND_TIME_AUTH_TYPES)[number] }>;

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

export interface RequestScripts {
    preRequest?: string;
    postResponse?: string;
}

/**
 * Resposta de exemplo da requisição, servida pelo mock server local. O corpo aceita
 * `{{$params.x}}`, `{{$query.x}}`, `{{$header.x}}`, `{{$body.campo}}`, `{{$uuid}}`, `{{$now}}`, `{{$timestamp}}` e `{{$randomInt}}`.
 */
export interface ResponseExample {
    name: string;
    status: number;
    headers: KeyValue[];
    body: string;
    /** Atraso antes de responder (simula latência). */
    delayMs: number;
}

/** Conteúdo de um arquivo de requisição da coleção (antes da interpolação de variáveis). */
export interface RequestDefinition {
    /** Identificador estável (`rq_…`), usado por `otto.request(id)`; gerado na primeira gravação. */
    id?: string;
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
    /** Scripts JavaScript executados antes do envio e depois da resposta (API `otto`). */
    scripts?: RequestScripts;
    /** Operação do spec OpenAPI que gerou a requisição (`MÉTODO /caminho`), usada na sincronização. */
    operation?: string;
    /** Respostas de exemplo (mock server); a primeira é a padrão. */
    examples?: ResponseExample[];
}

export const emptyExample = (name: string): ResponseExample => ({ name, status: 200, headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }], body: '', delayMs: 0 });

/** `rq_` + 10 caracteres base36. */
export const newRequestId = (): string => `rq_${Array.from(crypto.getRandomValues(new Uint8Array(10)), (byte) => (byte % 36).toString(36)).join('')}`;

export const emptyRequest = (name: string): RequestDefinition => ({
    name,
    method: 'GET',
    url: '',
    seq: null,
    params: [],
    headers: [],
    // Novas requisições herdam a autenticação da pasta/coleção (sem nada configurado, nada é enviado).
    auth: { type: 'inherit' },
    body: { type: 'none' },
    docs: ''
});
