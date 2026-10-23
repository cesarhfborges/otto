/** Headers que carregam o significado da resposta para quem consome a API. */
const SEMANTIC_HEADERS = new Set(['content-type', 'location', 'retry-after', 'www-authenticate', 'cache-control', 'content-disposition', 'link']);

/** `x-*` de segurança do navegador, proxies e CDNs: não fazem parte do contrato da API. */
const INFRA_X_HEADERS = new Set([
    'x-frame-options',
    'x-xss-protection',
    'x-powered-by',
    'x-content-type-options',
    'x-dns-prefetch-control',
    'x-download-options',
    'x-permitted-cross-domain-policies',
    'x-cache',
    'x-cache-hits',
    'x-served-by',
    'x-timer',
    'x-amz-cf-id',
    'x-amz-cf-pop',
    'x-varnish',
    'x-runtime',
    'x-aspnet-version',
    'x-aspnetmvc-version'
]);

/**
 * Se um header de uma resposta real vale a pena num exemplo do mock: os semânticos
 * e os `x-*` da própria aplicação (`X-Total-Count`, `X-RateLimit-*`…). Segurança,
 * cache, CORS e transporte ficam de fora; o mock gera os seus.
 */
export function isMockRelevantHeader(name: string): boolean {
    const lower = name.toLowerCase();

    return SEMANTIC_HEADERS.has(lower) || (lower.startsWith('x-') && !INFRA_X_HEADERS.has(lower));
}
