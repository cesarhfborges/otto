import type { CollectionNode, EntityId, HttpMethod, OpenedCollection } from '@shared/models';
import type { TreeNode } from 'primeng/api';

export type SidebarNodeKind = 'collection' | 'folder' | 'request';

/** Dados de cada nó da árvore lateral. `path` é relativo à raiz ('' = a própria coleção). */
export interface SidebarNodeData {
    kind: SidebarNodeKind;
    collectionId: EntityId;
    path: string;
    method: HttpMethod | null;
    error: string | null;
}

export type SidebarNode = TreeNode<SidebarNodeData>;

/** Todos os nós usam o mesmo template (`pTemplate="otto"`); o tipo real fica em `data.kind`. */
const TEMPLATE = 'otto';

export const nodeKey = (data: Pick<SidebarNodeData, 'kind' | 'collectionId' | 'path'>): string => `${data.kind}:${data.collectionId}:${data.path}`;

function toNode(collectionId: EntityId, node: CollectionNode, expanded: ReadonlySet<string>): SidebarNode {
    const data: SidebarNodeData = node.type === 'folder' ? { kind: 'folder', collectionId, path: node.path, method: null, error: null } : { kind: 'request', collectionId, path: node.path, method: node.method, error: node.error };
    const key = nodeKey(data);

    return {
        key,
        label: node.name,
        type: TEMPLATE,
        data,
        leaf: node.type === 'request',
        expanded: expanded.has(key),
        children: node.type === 'folder' ? node.children.map((child) => toNode(collectionId, child, expanded)) : undefined
    };
}

/** Converte as coleções abertas em nós do `p-tree`, preservando quais estavam expandidos. */
export function buildSidebarNodes(collections: readonly OpenedCollection[], expanded: ReadonlySet<string>): SidebarNode[] {
    return collections.map(({ metadata, tree }) => {
        const data: SidebarNodeData = { kind: 'collection', collectionId: metadata.id, path: '', method: null, error: null };
        const key = nodeKey(data);

        return { key, label: metadata.name, type: TEMPLATE, data, leaf: false, expanded: expanded.has(key), children: tree.children.map((child) => toNode(metadata.id, child, expanded)) };
    });
}

export function findNode(nodes: readonly SidebarNode[], key: string): SidebarNode | null {
    for (const node of nodes) {
        if (node.key === key) {
            return node;
        }

        const found = findNode((node.children ?? []) as SidebarNode[], key);

        if (found) {
            return found;
        }
    }

    return null;
}

/** Pasta onde criar itens a partir de um nó (a própria pasta ou a pasta da requisição). */
export function folderOf(data: SidebarNodeData): string {
    if (data.kind !== 'request') {
        return data.path;
    }

    const index = data.path.lastIndexOf('/');

    return index < 0 ? '' : data.path.slice(0, index);
}
