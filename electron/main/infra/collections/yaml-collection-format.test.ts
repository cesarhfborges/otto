import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyRequest, type RequestDefinition } from '../../../shared/models';
import { YamlCollectionFormat } from './yaml-collection-format';

const format = new YamlCollectionFormat();

const fullRequest: RequestDefinition = {
    name: 'Create user',
    method: 'POST',
    url: '{{baseUrl}}/users',
    seq: 2,
    params: [{ key: 'dryRun', value: 'true', enabled: false }],
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    auth: { type: 'bearer', token: '{{token}}' },
    body: { type: 'json', content: '{\n  "name": "Otto"\n}\n' },
    docs: '# Create user\n\nCreates a user.'
};

describe('YamlCollectionFormat', () => {
    it('faz ida e volta sem perder dados', () => {
        assert.deepEqual(format.parseRequest(format.serializeRequest(fullRequest)), fullRequest);

        const form: RequestDefinition = { ...emptyRequest('Login'), method: 'POST', body: { type: 'form-urlencoded', fields: [{ key: 'user', value: 'a', enabled: true }] } };

        assert.deepEqual(format.parseRequest(format.serializeRequest(form)), form);
    });

    it('gera YAML enxuto e legível (padrões omitidos, corpo em bloco)', () => {
        assert.equal(format.serializeRequest(emptyRequest('Ping')), 'name: Ping\nmethod: GET\nurl: ""\n');

        const yaml = format.serializeRequest(fullRequest);

        assert.match(yaml, /^name: Create user\nmethod: POST\nurl: "\{\{baseUrl\}\}\/users"\nseq: 2\n/);
        assert.match(yaml, /content: \|/);
        assert.match(yaml, /- key: Content-Type\n {4}value: application\/json\n/);
        assert.doesNotMatch(yaml, /enabled: true/);
    });

    it('aceita arquivos editados à mão com campos omitidos', () => {
        const request = format.parseRequest('name: Health\nmethod: get\nurl: http://localhost/health\nheaders:\n  - key: Accept\n    value: "*/*"\n');

        assert.equal(request.method, 'GET');
        assert.deepEqual(request.headers, [{ key: 'Accept', value: '*/*', enabled: true }]);
        assert.deepEqual(request.body, { type: 'none' });
    });

    it('rejeita conteúdo inválido com mensagem útil', () => {
        assert.throws(() => format.parseRequest('name: [unclosed'), /Invalid YAML/);
        assert.throws(() => format.parseRequest('name: X\nmethod: FETCH\n'), /request.method/);
        assert.throws(() => format.parseRequest('- just\n- a list\n'), /"request"/);
        assert.throws(() => format.parseRequest('name: a\nname: b\nmethod: GET\n'), /Invalid YAML/);
    });

    it('protege contra explosão de aliases', () => {
        const bomb = [
            'a: &a ["x","x","x","x","x","x","x","x","x","x"]',
            ...Array.from(
                { length: 12 },
                (_, i) =>
                    `${String.fromCharCode(98 + i)}: &${String.fromCharCode(98 + i)} [*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)}]`
            )
        ].join('\n');

        assert.throws(() => format.parseRequest(bomb), /Invalid YAML|alias/i);
    });

    it('lê e escreve o manifesto, recusando formato mais novo', () => {
        const manifest = { version: 1, name: 'Petstore', description: 'Demo API' };

        assert.deepEqual(format.parseManifest(format.serializeManifest(manifest)), manifest);
        assert.deepEqual(format.parseManifest('name: Minimal\n'), { version: 1, name: 'Minimal', description: '' });
        assert.throws(() => format.parseManifest('version: 99\nname: Future\n'), /newer than this app supports/);
        assert.throws(() => format.parseManifest('description: no name\n'), /"name"/);
    });

    it('identifica arquivos de requisição', () => {
        assert.equal(format.isRequestFile('get-users.yaml'), true);
        assert.equal(format.isRequestFile('otto.yaml'), false);
        assert.equal(format.isRequestFile('notes.md'), false);
        assert.equal(format.requestFileName('get-users'), 'get-users.yaml');
    });
});
