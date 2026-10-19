import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCollectionPatch, parseEnvironmentPatch, parseHistoryQuery, parseHttpRequest, parseNewCollection, parseNewEnvironment, parseRequestId, parseSettingsPatch, parseTabs, parseWindowBounds } from './index';

describe('parseHttpRequest', () => {
    it('normaliza uma requisição válida', () => {
        const request = parseHttpRequest({ id: '1', method: 'POST', url: '  https://example.com  ', headers: { ' X-Test ': 'a', Bad: 1, ' ': 'x' }, body: '{}', timeoutMs: 500 });

        assert.deepEqual(request, { id: '1', method: 'POST', url: 'https://example.com', headers: { 'X-Test': 'a' }, body: '{}', timeoutMs: 500 });
    });

    it('descarta body e timeout inválidos', () => {
        const request = parseHttpRequest({ id: '1', method: 'GET', url: 'http://x', body: 42, timeoutMs: -1 });

        assert.equal(request.body, undefined);
        assert.equal(request.timeoutMs, undefined);
    });

    it('rejeita entradas inválidas', () => {
        assert.throws(() => parseHttpRequest(null), /"request": expected an object/);
        assert.throws(() => parseHttpRequest([]), /"request": expected an object/);
        assert.throws(() => parseHttpRequest({ method: 'GET', url: 'x' }), /"request.id"/);
        assert.throws(() => parseHttpRequest({ id: '1', method: 'TRACE', url: 'x' }), /"request.method"/);
        assert.throws(() => parseHttpRequest({ id: '1', method: 'GET' }), /"request.url"/);
    });
});

describe('parseRequestId', () => {
    it('aceita apenas strings não vazias', () => {
        assert.equal(parseRequestId('abc'), 'abc');
        assert.throws(() => parseRequestId(''));
        assert.throws(() => parseRequestId(1));
        assert.throws(() => parseRequestId('x'.repeat(201)));
    });
});

describe('parseSettingsPatch / parseWindowBounds', () => {
    it('mantém apenas campos conhecidos, em qualquer nível', () => {
        assert.deepEqual(parseSettingsPatch({ minimizeToTray: false, evil: true }), { minimizeToTray: false });
        assert.deepEqual(parseSettingsPatch({ theme: 'dark', http: { timeoutMs: 0, extra: 1, proxy: { url: ' http://p:8080 ' } } }), { theme: 'dark', http: { timeoutMs: 0, proxy: { url: 'http://p:8080' } } });
        assert.deepEqual(parseSettingsPatch({}), {});
    });

    it('rejeita valores inválidos de campos conhecidos', () => {
        assert.throws(() => parseSettingsPatch(undefined), /"settings"/);
        assert.throws(() => parseSettingsPatch({ minimizeToTray: 'yes' }), /settings.minimizeToTray/);
        assert.throws(() => parseSettingsPatch({ theme: 'neon' }), /settings.theme/);
        assert.throws(() => parseSettingsPatch({ http: 5 }), /settings.http/);
        assert.throws(() => parseSettingsPatch({ http: { timeoutMs: -1 } }), /settings.http.timeoutMs/);
        assert.throws(() => parseSettingsPatch({ http: { timeoutMs: 3_600_001 } }), /at most/);
        assert.throws(() => parseSettingsPatch({ http: { proxy: { url: 'socks5://p:1080' } } }), /only http/);
        assert.throws(() => parseSettingsPatch({ http: { proxy: { url: 'not a url' } } }), /valid URL/);
        assert.throws(() => parseSettingsPatch({ http: { ssl: { caCertificatePath: 'ca.pem' } } }), /absolute path/);
    });

    it('normaliza o caminho do certificado e aceita limpar', () => {
        assert.deepEqual(parseSettingsPatch({ http: { ssl: { caCertificatePath: '/etc/ssl/../ca.pem' } } }), { http: { ssl: { caCertificatePath: '/etc/ca.pem' } } });
        assert.deepEqual(parseSettingsPatch({ http: { ssl: { caCertificatePath: null } } }), { http: { ssl: { caCertificatePath: null } } });
        assert.deepEqual(parseSettingsPatch({ http: { ssl: { caCertificatePath: '' } } }), { http: { ssl: { caCertificatePath: null } } });
    });

    it('valida os limites da janela', () => {
        assert.deepEqual(parseWindowBounds({ x: 1, y: 2, width: 3, height: 4, extra: 5 }), { x: 1, y: 2, width: 3, height: 4 });
        assert.equal(parseWindowBounds({ x: 1, y: 2, width: 3 }), null);
        assert.equal(parseWindowBounds({ x: 1, y: 2, width: 3, height: Number.NaN }), null);
    });
});

describe('parseHistoryQuery', () => {
    it('aceita filtros opcionais válidos', () => {
        assert.deepEqual(parseHistoryQuery(undefined), {});
        assert.deepEqual(parseHistoryQuery({ limit: 10, offset: 0, collectionId: 'c1', other: 1 }), { limit: 10, offset: 0, collectionId: 'c1' });
        assert.throws(() => parseHistoryQuery({ limit: 0 }), /query.limit/);
        assert.throws(() => parseHistoryQuery({ offset: 1.5 }), /query.offset/);
    });
});

describe('parseTabs', () => {
    const tab = { id: 't1', kind: 'request', title: 'Get users', resourceRef: 'users/list.yaml', position: 0, active: true, draft: null };

    it('aceita abas válidas', () => {
        assert.deepEqual(parseTabs([tab]), [tab]);
        assert.deepEqual(parseTabs([{ ...tab, resourceRef: undefined }])[0]!.resourceRef, null);
    });

    it('rejeita abas inválidas', () => {
        assert.throws(() => parseTabs({}), /expected an array/);
        assert.throws(() => parseTabs([{ ...tab, kind: 'evil' }]), /tabs\[0\].kind/);
        assert.throws(() => parseTabs([{ ...tab, active: 1 }]), /tabs\[0\].active/);
        assert.throws(() => parseTabs([tab, { ...tab }]), /unique/);
        assert.throws(() => parseTabs([tab, { ...tab, id: 't2' }]), /at most one tab/);
    });
});

describe('parseNewEnvironment / parseEnvironmentPatch', () => {
    it('aplica padrões e valida variáveis', () => {
        assert.deepEqual(parseNewEnvironment({ name: ' dev ' }), { collectionId: null, name: 'dev', variables: [] });
        assert.deepEqual(parseNewEnvironment({ name: 'dev', collectionId: 'c1', variables: [{ key: 'a', value: '1' }] }).variables, [{ key: 'a', value: '1', enabled: true, secret: false }]);
        assert.throws(() => parseNewEnvironment({ name: '  ' }), /environment.name/);
        assert.throws(() => parseNewEnvironment({ name: 'dev', variables: [{ key: 'a', value: 1 }] }), /variables\[0\].value/);
    });

    it('mantém apenas os campos enviados no patch', () => {
        assert.deepEqual(parseEnvironmentPatch({ name: 'prod' }), { name: 'prod' });
        assert.deepEqual(parseEnvironmentPatch({ collectionId: null }), { collectionId: null });
        assert.throws(() => parseEnvironmentPatch(null), /"patch"/);
    });
});

describe('parseNewCollection / parseCollectionPatch', () => {
    it('exige caminho absoluto e normaliza', () => {
        assert.deepEqual(parseNewCollection({ name: 'API', path: '/tmp/a/../api' }), { name: 'API', path: '/tmp/api', source: null, lastOpenedAt: null });
        assert.throws(() => parseNewCollection({ name: 'API', path: 'relative/dir' }), /absolute path/);
    });

    it('valida a origem remota', () => {
        const source = { kind: 'openapi', location: 'https://x/openapi.json' };

        assert.deepEqual(parseNewCollection({ name: 'API', path: '/tmp/api', source }).source, { ...source, lastHash: null, lastCheckedAt: null });
        assert.throws(() => parseNewCollection({ name: 'API', path: '/tmp/api', source: { kind: 'soap', location: 'x' } }), /source.kind/);
        assert.deepEqual(parseCollectionPatch({ lastOpenedAt: '2026-01-01T00:00:00.000Z' }), { lastOpenedAt: '2026-01-01T00:00:00.000Z' });
    });
});
