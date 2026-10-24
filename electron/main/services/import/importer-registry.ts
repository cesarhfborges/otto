import type { ICollectionImporter, ImportedCollection, ImportSource } from '../../core/contracts';

/**
 * Registro de importadores (OCP): o core não conhece os formatos concretos,
 * apenas delega ao primeiro importador que se declara capaz de ler a fonte.
 */
export class ImporterRegistry {
    private readonly importers = new Map<string, ICollectionImporter>();

    register(importer: ICollectionImporter): this {
        if (this.importers.has(importer.id)) {
            throw new Error(`Importer "${importer.id}" is already registered`);
        }

        this.importers.set(importer.id, importer);

        return this;
    }

    list(): ICollectionImporter[] {
        return [...this.importers.values()];
    }

    resolve(source: ImportSource): ICollectionImporter | null {
        return this.list().find((importer) => importer.canImport(source)) ?? null;
    }

    async import(source: ImportSource): Promise<ImportedCollection> {
        const importer = this.resolve(source);

        if (!importer) {
            throw new Error(`No importer can read "${source.location}"`);
        }

        return importer.import(source);
    }
}
