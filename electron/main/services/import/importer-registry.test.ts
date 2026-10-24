import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ICollectionImporter, ImportSource } from '../../core/contracts';
import { ImporterRegistry } from './importer-registry';

const fakeImporter = (id: string, extension: string): ICollectionImporter => ({
    id,
    label: id,
    canImport: (source: ImportSource) => source.location.endsWith(extension),
    import: async () => ({ name: id, version: null, description: null, baseUrl: null, requests: [] })
});

describe('ImporterRegistry', () => {
    it('delega ao importador capaz de ler a fonte', async () => {
        const registry = new ImporterRegistry().register(fakeImporter('json', '.json')).register(fakeImporter('yaml', '.yaml'));
        const result = await registry.import({ location: 'spec.yaml', content: '' });

        assert.equal(result.name, 'yaml');
        assert.equal(registry.list().length, 2);
    });

    it('falha quando nenhum importador reconhece a fonte', async () => {
        const registry = new ImporterRegistry().register(fakeImporter('json', '.json'));

        assert.equal(registry.resolve({ location: 'spec.xml', content: '' }), null);
        await assert.rejects(registry.import({ location: 'spec.xml', content: '' }), /No importer/);
    });

    it('impede ids duplicados', () => {
        const registry = new ImporterRegistry().register(fakeImporter('json', '.json'));

        assert.throws(() => registry.register(fakeImporter('json', '.yml')), /already registered/);
    });
});
