import { CRYPTO_FUNCTIONS } from './functions/crypto';
import { DATE_FUNCTIONS } from './functions/date';
import { ENCODING_FUNCTIONS } from './functions/encoding';
import { FALLBACK_FUNCTIONS } from './functions/fallback';
import { ID_FUNCTIONS } from './functions/ids';
import { JSON_FUNCTIONS } from './functions/json';
import { JWT_FUNCTIONS } from './functions/jwt';
import { RANDOM_FUNCTIONS } from './functions/random';
import { STRING_FUNCTIONS } from './functions/text';
import { arg, fn, ns, opt, prop, type CatalogNode, type Where } from './node';

/** Leitura de mensagens (§3.6): igual em `otto.request` e `otto.collection.request(…).request/.response`. */
function messageMembers(kind: 'request' | 'response'): CatalogNode[] {
    const common = [
        fn('get', 'any', 'Body value (JSONPath)', [arg('path', { source: 'paths' })]),
        fn('getAll', 'array', 'All body values that match', [arg('path', { source: 'paths' })]),
        fn('has', 'boolean', 'Whether the path exists', [arg('path', { source: 'paths' })]),
        fn('count', 'number', 'How many values match', [arg('path', { source: 'paths' })]),
        fn('text', 'string', 'Body as text', []),
        fn('json', 'object', 'Body as JSON (chainable)', []),
        prop('body', 'string', 'Body as text (same as text())'),
        prop('bodyType', 'string', 'json, xml, text, form-urlencoded…'),
        fn('base64', 'string', 'Body in Base64', []),
        prop('size', 'number', 'Body size in bytes'),
        fn('header', 'string', 'Header value', [arg('name', { source: 'headers' })]),
        fn('headerAll', 'array', 'All values of a header', [arg('name', { source: 'headers' })]),
        fn('headers', 'Headers', 'All headers', []),
        fn('hasHeader', 'boolean', 'Whether the header exists', [arg('name', { source: 'headers' })]),
        prop('contentType', 'string', 'Content-Type without parameters'),
        fn('cookie', 'string', 'Cookie value', [arg('name', { source: 'cookies' })]),
        fn('cookies', 'Cookies', 'All cookies (name=value; …)', []),
        fn('hasCookie', 'boolean', 'Whether the cookie exists', [arg('name', { source: 'cookies' })]),
        prop('url', 'string', kind === 'response' ? 'Final URL (after redirects)' : 'URL'),
        prop('host', 'string', 'Host of the URL'),
        prop('pathname', 'string', 'Path of the URL'),
        prop('protocol', 'string', 'Protocol of the URL'),
        prop('port', 'string', 'Port of the URL')
    ];

    return kind === 'request'
        ? [
              ...common,
              prop('method', 'string', 'HTTP method'),
              fn('param', 'string', 'Query parameter', [arg('name', { source: 'params' })]),
              fn('params', 'object', 'All query parameters', []),
              fn('form', 'string', 'Form field', [arg('name', { source: 'forms' })]),
              fn('forms', 'object', 'All form fields', []),
              prop('auth', 'object', 'Authentication (type, token, username…)')
          ]
        : [
              ...common,
              fn('cookieInfo', 'object', 'Details of a Set-Cookie', [arg('name', { source: 'cookies' })]),
              prop('status', 'number', 'Status code'),
              prop('code', 'number', 'Status code (alias of status)'),
              prop('statusText', 'string', 'Status text'),
              prop('ok', 'boolean', 'Status 2xx'),
              prop('time', 'number', 'Total time (ms)'),
              prop('timings', 'object', 'ttfb, download, total (ms)'),
              prop('receivedAt', 'string', 'ISO 8601'),
              prop('age', 'number', 'Seconds since received'),
              prop('redirected', 'boolean', 'Whether it was redirected')
          ];
}

const IDENTIFICATION = [prop('id', 'string', 'Stable id'), prop('name', 'string', 'Name'), prop('path', 'string', 'File in the collection'), prop('folder', 'string', 'Folder')];

export const REQUEST_REF_OPTIONS = { send: ['never', 'empty', 'expired', 'always'] } as const;

/** Catálogo do objeto `otto`. Um módulo novo de funções entra aqui e passa a valer em validação, autocomplete e execução. */
export const OTTO_CATALOG: CatalogNode = ns('otto', 'Otto commands and request data', [
    { ...ns('request', 'The request being sent (read-only in templates)', [...IDENTIFICATION, ...messageMembers('request')]), kind: 'object', returns: 'Request', example: "{{ otto.request.header('X-Trace') }}" },
    ns('collection', 'This collection and its requests', [
        prop('name', 'string', 'Collection name'),
        prop('id', 'string', 'Collection id'),
        fn('request', 'RequestRef', 'Another request of this collection', [arg('ref', { source: 'requests' }), opt('options')], undefined, {
            example: "{{ otto.collection.request('rq_…', { send: 'expired', maxAge: 600 }).response.get('$.token') }}",
            result: [
                { ...ns('response', 'Last response of the request', messageMembers('response')), kind: 'object', returns: 'Response' },
                { ...ns('request', 'Definition of the request (interpolated)', messageMembers('request')), kind: 'object', returns: 'Request' },
                ...IDENTIFICATION,
                prop('method', 'string', 'HTTP method'),
                prop('hasResponse', 'boolean', 'Whether a response is stored')
            ]
        })
    ]),
    { ...ns('info', 'Environment, collection, workspace and app', [prop('environment', 'string', 'Selected environment'), prop('collection', 'string', 'Collection name'), prop('workspace', 'string', 'Workspace name'), ns('app', 'Otto', [prop('version', 'string', 'Otto version')]), prop('platform', 'string', 'linux, win32 or darwin')]), kind: 'object', returns: 'Info' },
    ...ID_FUNCTIONS,
    ...DATE_FUNCTIONS,
    ...RANDOM_FUNCTIONS,
    ...ENCODING_FUNCTIONS,
    ...CRYPTO_FUNCTIONS,
    ...JWT_FUNCTIONS,
    ...STRING_FUNCTIONS,
    ...JSON_FUNCTIONS,
    ...FALLBACK_FUNCTIONS
]);

export const availableIn = (node: CatalogNode, where: Where): boolean => (node.where ?? ['T', 'Pre', 'Post']).includes(where);

/** Membros acessíveis depois de `node` (após chamada, os do resultado). */
export const membersAfter = (node: CatalogNode, called: boolean): readonly CatalogNode[] => (called ? (node.result ?? []) : (node.members ?? []));
