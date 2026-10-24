import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyRequest, type RequestDefinition } from '../models';
import { buildHttpRequest } from './build-request';

const definition = (overrides: Partial<RequestDefinition>): RequestDefinition => ({ ...emptyRequest('test'), url: 'https://api.test/users', ...overrides });

describe('buildHttpRequest', () => {
    it('anexa params habilitados à URL e mantém a origem', () => {
        const request = buildHttpRequest(
            definition({
                url: 'https://api.test/users?sort=name#top',
                params: [
                    { key: 'page', value: '2', enabled: true },
                    { key: 'q', value: 'a b&c', enabled: true },
                    { key: 'off', value: 'x', enabled: false },
                    { key: ' ', value: 'empty key', enabled: true }
                ]
            }),
            { id: 'r1', source: { collectionId: 'c1', requestPath: 'users.yaml' } }
        );

        assert.equal(request.url, 'https://api.test/users?sort=name&page=2&q=a%20b%26c#top');
        assert.equal(request.id, 'r1');
        assert.deepEqual(request.source, { collectionId: 'c1', requestPath: 'users.yaml' });
        assert.equal('body' in request, false);
    });

    it('completa o esquema http:// quando ausente', () => {
        assert.equal(buildHttpRequest(definition({ url: '  localhost:3000/health ' }), { id: '1' }).url, 'http://localhost:3000/health');
        assert.equal(buildHttpRequest(definition({ url: '' }), { id: '1' }).url, '');
    });

    it('aplica headers habilitados (sem diferenciar maiúsculas) e a autenticação', () => {
        const headers = (overrides: Partial<RequestDefinition>) => buildHttpRequest(definition(overrides), { id: '1' }).headers;

        assert.deepEqual(
            headers({
                headers: [
                    { key: 'accept', value: 'text/plain', enabled: true },
                    { key: 'Accept', value: 'application/json', enabled: true },
                    { key: 'X-Off', value: '1', enabled: false }
                ],
                auth: { type: 'bearer', token: 'abc' }
            }),
            { Accept: 'application/json', Authorization: 'Bearer abc' }
        );
        assert.deepEqual(headers({ auth: { type: 'basic', username: 'josé', password: 'p:w' } }), { Authorization: `Basic ${Buffer.from('josé:p:w').toString('base64')}` });
        assert.deepEqual(headers({ auth: { type: 'apikey', key: 'X-Api-Key', value: 'k', in: 'header' } }), { 'X-Api-Key': 'k' });
        assert.deepEqual(headers({ auth: { type: 'inherit' } }), {});
    });

    it('envia a API key na query quando configurado', () => {
        assert.equal(buildHttpRequest(definition({ auth: { type: 'apikey', key: 'api_key', value: 'k 1', in: 'query' } }), { id: '1' }).url, 'https://api.test/users?api_key=k%201');
    });

    it('monta o corpo com Content-Type padrão, sem sobrescrever o informado', () => {
        const json = buildHttpRequest(definition({ method: 'POST', body: { type: 'json', content: '{"a":1}' } }), { id: '1' });
        const custom = buildHttpRequest(definition({ method: 'POST', headers: [{ key: 'content-type', value: 'application/vnd.api+json', enabled: true }], body: { type: 'json', content: '{}' } }), { id: '1' });
        const form = buildHttpRequest(
            definition({
                method: 'POST',
                body: {
                    type: 'form-urlencoded',
                    fields: [
                        { key: 'user', value: 'a@b.c', enabled: true },
                        { key: 'skip', value: '1', enabled: false }
                    ]
                }
            }),
            { id: '1' }
        );

        assert.equal(json.body, '{"a":1}');
        assert.equal(json.headers!['Content-Type'], 'application/json');
        assert.deepEqual(custom.headers, { 'content-type': 'application/vnd.api+json' });
        assert.equal(form.body, 'user=a%40b.c');
        assert.equal(form.headers!['Content-Type'], 'application/x-www-form-urlencoded');
    });
});
