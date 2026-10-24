import type { CollectionFolderNode, KeyValue, OpenedCollection, RequestAuth, RequestScripts } from '../models';

/** Um nível que repassa autenticação, variáveis e scripts para o que está dentro dele. */
export interface InheritanceLevel {
    kind: 'collection' | 'folder';
    /** Caminho da pasta (`a/b`); `''` na coleção. */
    path: string;
    /** `Collection` ou o nome da pasta. */
    label: string;
    auth: RequestAuth;
    variables: readonly KeyValue[];
    scripts: RequestScripts;
}

/** Pasta que contém o arquivo (`a/b/x.yaml` → `a/b`; na raiz → `''`). */
export const parentFolder = (path: string): string => path.split('/').slice(0, -1).join('/');

/**
 * Coleção e pastas de `folder` até a raiz, do mais externo (coleção) ao mais interno.
 * `folder` entra na lista (é o nível mais próximo de uma requisição dentro dele).
 */
export function inheritanceChain(collection: OpenedCollection, folder: string): InheritanceLevel[] {
    const levels: InheritanceLevel[] = [{ kind: 'collection', path: '', label: 'Collection', auth: collection.manifest.auth, variables: collection.manifest.variables, scripts: collection.manifest.scripts }];
    let nodes = collection.tree.children;
    let current = '';

    for (const segment of folder.split('/').filter(Boolean)) {
        current = current ? `${current}/${segment}` : segment;
        const node = nodes.find((item): item is CollectionFolderNode => item.type === 'folder' && item.path === current);

        if (!node) {
            break;
        }

        levels.push({ kind: 'folder', path: node.path, label: node.name, ...node.settings });
        nodes = node.children;
    }

    return levels;
}

/** Autenticação efetiva de `auth: inherit`: a da pasta mais próxima que define uma, ou a da coleção. */
export function resolveInheritedAuth(chain: readonly InheritanceLevel[], auth: RequestAuth): { auth: RequestAuth; from: InheritanceLevel | null } {
    if (auth.type !== 'inherit') {
        return { auth, from: null };
    }

    for (const level of [...chain].reverse()) {
        if (level.auth.type !== 'inherit') {
            return { auth: level.auth, from: level };
        }
    }

    return { auth: { type: 'none' }, from: null };
}
