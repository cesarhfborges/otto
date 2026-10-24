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
        // Requisições não recebem itens dentro delas, só antes/depois.
        droppable: node.type === 'folder',
        expanded: expanded.has(key),
        children: node.type === 'folder' ? node.children.map((child) => toNode(collectionId, child, expanded)) : undefined
    };
}

/** Converte as coleções abertas em nós do `p-tree`, preservando quais estavam expandidos. */
export function buildSidebarNodes(collections: readonly OpenedCollection[], expanded: ReadonlySet<string>): SidebarNode[] {
    return collections.map(({ metadata, tree }) => {
        const data: SidebarNodeData = { kind: 'collection', collectionId: metadata.id, path: '', method: null, error: null };
        const key = nodeKey(data);

        // A coleção é a raiz da pasta no disco: recebe itens, mas não é arrastável.
        return { key, label: metadata.name, type: TEMPLATE, data, leaf: false, draggable: false, expanded: expanded.has(key), children: tree.children.map((child) => toNode(metadata.id, child, expanded)) };
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

/** Pasta que contém o caminho ('' = raiz da coleção). */
export function parentPath(path: string): string {
    const index = path.lastIndexOf('/');

    return index < 0 ? '' : path.slice(0, index);
}

/** Pasta onde criar itens a partir de um nó (a própria pasta ou a pasta da requisição). */
export function folderOf(data: SidebarNodeData): string {
    return data.kind === 'request' ? parentPath(data.path) : data.path;
}

/** Nó da pasta (ou coleção) que contém o item. */
export function parentKey(data: SidebarNodeData): string {
    const parent = parentPath(data.path);

    return nodeKey({ kind: parent ? 'folder' : 'collection', collectionId: data.collectionId, path: parent });
}

export type DropPosition = 'before' | 'inside' | 'after';

/** Mesma regra do `p-tree`: quarto superior/inferior do item solta antes/depois dele; o meio, dentro. */
export function dropPositionOf(event: DragEvent): DropPosition {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const y = event.clientY - rect.top;

    return y < rect.height * 0.25 ? 'before' : y > rect.height * 0.75 ? 'after' : 'inside';
}

/** Destino de um item solto: a pasta (ou coleção) que o recebe e seus filhos já na nova ordem. */
export interface DropTarget {
    parent: SidebarNode;
    children: SidebarNode[];
}

/**
 * Resolve onde o item arrastado vai parar. `null` quando o destino é inválido:
 * fora de uma coleção (antes/depois de uma coleção, que é sempre raiz) ou dentro de uma requisição.
 */
export function resolveDrop(dragNode: SidebarNode, dropNode: SidebarNode, position: DropPosition): DropTarget | null {
    const parent = (position === 'inside' ? dropNode : dropNode.parent) as SidebarNode | undefined;

    if (!parent?.data || parent.data.kind === 'request') {
        return null;
    }

    const children = ((parent.children ?? []) as SidebarNode[]).filter((node) => node !== dragNode);
    const index = position === 'inside' ? children.length : children.indexOf(dropNode) + (position === 'after' ? 1 : 0);

    children.splice(index, 0, dragNode);

    return { parent, children };
}

/** Caminho do item ao ser colocado em outra pasta, mantendo o nome do arquivo/pasta. */
export function pathInFolder(folder: string, path: string): string {
    const name = path.slice(path.lastIndexOf('/') + 1);

    return folder ? `${folder}/${name}` : name;
}
