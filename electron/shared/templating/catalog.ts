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

/** Corpo de uma mensagem: um parser por formato (`body.json(…)`, `body.xml(…)`…). */
const BODY_MEMBERS = [
    fn('json', 'any', 'Body as JSON; with a JSONPath, the first match', [opt('path', { source: 'paths' })], undefined, { example: "{{ otto.request('rq_…').response.body.json('$.access_token') }}" }),
    fn('jsonAll', 'array', 'All JSONPath matches', [arg('path', { source: 'paths' })]),
    fn('xml', 'any', 'First XPath match', [arg('xpath')], undefined, { example: "{{ otto.request('rq_…').response.body.xml('//auth/token/text()') }}" }),
    fn('html', 'string', 'First CSS selector match (::text or ::attr(name))', [arg('selector')], undefined, { example: `{{ otto.request('rq_…').response.body.html('input[name="_csrf"]::attr(value)') }}` }),
    fn('regex', 'string', 'Regex match (group: index or name; default the whole match)', [arg('pattern'), opt('group')], undefined, { example: "{{ otto.request('rq_…').response.body.regex('token=([a-zA-Z0-9]+)', 1) }}" }),
    fn('text', 'string', 'Body as text', []),
    fn('base64', 'string', 'Body in Base64', []),
    prop('parsed', 'any', 'Body parsed by Content-Type (JSON, form…; otherwise text)'),
    prop('type', 'string', 'json, xml, text, form-urlencoded…'),
    prop('size', 'number', 'Body size in bytes')
];

/** Leitura de mensagens (§3.6): igual em `otto.request` e `otto.request(…).request/.response`. */
function messageMembers(kind: 'request' | 'response'): CatalogNode[] {
    const common: CatalogNode[] = [
        { ...ns('body', 'Body, with one parser per format', BODY_MEMBERS), kind: 'object', returns: 'Body' },
        fn('json', 'any', 'Body as JSON (shortcut of body.json)', [opt('path', { source: 'paths' })], undefined, { example: "{{ otto.request('rq_…').response.json('$.token') }}" }),
        prop('data', 'any', 'Body parsed by Content-Type (shortcut of body.parsed)'),
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

/**
 * `otto.request`: sem chamar, a requisição atual (`otto.request.header('X')`); chamada
 * com uma referência, outra requisição da coleção (`otto.request('rq_…').response.json('$.token')`).
 */
const REQUEST: CatalogNode = fn('request', 'RequestRef', 'The request being sent, or another request of this collection when called', [arg('ref', { source: 'requests' }), opt('options')], undefined, {
    example: "{{ otto.request('rq_…', { send: 'expired', maxAge: 600 }).response.json('$.token') }}",
    members: [...IDENTIFICATION, ...messageMembers('request')],
    result: [
        { ...ns('response', 'Last response of the request', messageMembers('response')), kind: 'object', returns: 'Response' },
        { ...ns('request', 'Definition of the request (interpolated)', messageMembers('request')), kind: 'object', returns: 'Request' },
        ...IDENTIFICATION,
        prop('method', 'string', 'HTTP method'),
        prop('hasResponse', 'boolean', 'Whether a response is stored')
    ]
});

/** `otto.cookies`: cookies guardados na coleção (implementado pelo `OttoHost`). */
const COOKIES: CatalogNode = ns('cookies', 'Cookies stored in this collection', [
    fn('get', 'string', 'Cookie value', [arg('name')], undefined, { example: "{{ otto.cookies.get('session') }}" }),
    fn('has', 'boolean', 'Whether the cookie exists', [arg('name')]),
    fn('all', 'array', 'All cookies (name, value, domain, path…)', []),
    fn('header', 'string', 'Cookie header value (name=value; …), optionally only the ones for a URL', [opt('url')]),
    fn('set', 'string', 'Add or replace a cookie (options: domain, path, expires, secure, httpOnly); returns empty text', [arg('name'), arg('value'), opt('options')], undefined, { example: "{{ otto.cookies.set('token', $.token, { domain: 'localhost', path: '/' }) }}" }),
    fn('remove', 'string', 'Remove a cookie (all domains when omitted); returns empty text', [arg('name'), opt('domain')]),
    fn('clear', 'string', 'Remove every cookie of the collection (or of a domain); returns empty text', [opt('domain')])
]);

/** Catálogo do objeto `otto`. Um módulo novo de funções entra aqui e passa a valer em validação, autocomplete e execução. */
export const OTTO_CATALOG: CatalogNode = ns('otto', 'Otto commands and request data', [
    REQUEST,
    COOKIES,
    ns('collection', 'This collection', [prop('name', 'string', 'Collection name'), prop('id', 'string', 'Collection id')]),
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
