import { inject, Injectable, resource } from '@angular/core';
import { inheritanceChain, parentFolder, resolveInheritedAuth, type InheritanceLevel } from '@shared/http/inheritance';
import { interpolateRequest, type InterpolationResult } from '@shared/http/interpolate';
import type { CollectionNode, EntityId, RequestAuth, RequestDefinition } from '@shared/models';
import { requestSnapshot, VariableScopes, type MessageSnapshot, type VariableLayer, type OttoHost, type RequestRefHandle, type ValidationEnv } from '@shared/templating';
import { AppInfoGateway, CollectionFilesGateway } from '../ports';
import { CollectionsState } from '../state/collections.state';
import { EnvironmentsState } from '../state/environments.state';
import { draftKey, RequestDraftsState } from '../state/request-drafts.state';
import { WorkspacesState } from '../state/workspaces.state';

export interface CollectionRequestEntry {
    id: string | null;
    name: string;
    path: string;
    folder: string;
    method: string;
}

/** Últimas respostas e envio de requisições referenciadas (implementado por `ResponsesState`). */
export interface ResponseAccess {
    lastResponse(collectionId: EntityId, path: string): MessageSnapshot | null;
    /** Envia a requisição referenciada e devolve a resposta; `chain` detecta ciclos A → B → A. */
    sendReferenced(collectionId: EntityId, path: string, chain: readonly string[]): Promise<MessageSnapshot>;
}

const flatten = (nodes: readonly CollectionNode[]): CollectionRequestEntry[] =>
    nodes.flatMap((node) => (node.type === 'folder' ? flatten(node.children) : node.method ? [{ id: node.id, name: node.name, path: node.path, folder: node.path.split('/').slice(0, -1).join('/'), method: node.method }] : []));

/**
 * Liga o motor de templates (`@shared/templating`) ao estado do app: cadeia de
 * escopos de variáveis, requisições da coleção e o `OttoHost` usado no envio.
 */
@Injectable({ providedIn: 'root' })
export class TemplateContextService {
    private readonly environments = inject(EnvironmentsState);
    private readonly collections = inject(CollectionsState);
    private readonly drafts = inject(RequestDraftsState);
    private readonly files = inject(CollectionFilesGateway);
    private readonly workspaces = inject(WorkspacesState);
    private readonly appInfoGateway = inject(AppInfoGateway);
    private readonly appInfo = resource({ loader: () => this.appInfoGateway.info() });

    /**
     * Ambiente selecionado, variáveis das pastas (da mais próxima de `folder` à raiz) e as
     * da coleção, nessa ordem de precedência. Lê signals: reativo em `computed`.
     */
    scopes(collectionId: EntityId | null, folder = ''): VariableScopes {
        const environment = collectionId ? this.environments.selected(collectionId) : null;
        const folders = this.chain(collectionId, folder).filter((level) => level.kind === 'folder');
        const collection = this.collections.find(collectionId);

        return new VariableScopes([
            ...(environment ? [{ scope: 'env' as const, label: environment.name, items: environment.variables }] : []),
            ...folders.reverse().map((level) => ({ scope: 'folder' as const, label: `Folder ${level.label}`, items: level.variables })),
            ...(collection ? [{ scope: 'collection' as const, label: 'Collection', items: collection.manifest.variables }] : [])
        ]);
    }

    /** Coleção e pastas até `folder` (da coleção para dentro): autenticação, variáveis e scripts herdados. */
    chain(collectionId: EntityId | null, folder: string): InheritanceLevel[] {
        const collection = this.collections.find(collectionId);

        return collection ? inheritanceChain(collection, folder) : [];
    }

    /** O que `auth: inherit` usaria num item de `folder` (pasta própria incluída): a autenticação e de onde vem. */
    inheritedAuth(collectionId: EntityId | null, folder: string): { auth: RequestAuth; from: string } | null {
        const { from, auth } = resolveInheritedAuth(this.chain(collectionId, folder), { type: 'inherit' });

        return from ? { auth, from: from.kind === 'collection' ? 'the collection' : `folder "${from.label}"` } : null;
    }

    /** `auth: inherit` trocado pela autenticação da pasta mais próxima (ou da coleção). */
    withInheritedAuth(collectionId: EntityId, path: string, definition: RequestDefinition): RequestDefinition {
        return definition.auth.type === 'inherit' ? { ...definition, auth: resolveInheritedAuth(this.chain(collectionId, parentFolder(path)), definition.auth).auth } : definition;
    }

    requests(collectionId: EntityId | null): CollectionRequestEntry[] {
        return flatten(this.collections.find(collectionId)?.tree.children ?? []);
    }

    /** Por `id` estável ou caminho (`auth/login` ou `auth/login.yaml`). */
    findRequest(collectionId: EntityId | null, ref: string): CollectionRequestEntry | null {
        const requests = this.requests(collectionId);

        return requests.find((request) => request.id === ref) ?? requests.find((request) => request.path === ref || request.path.replace(/\.[^./]+$/, '') === ref) ?? null;
    }

    /** `local`: variáveis em edição (ainda não salvas), que vencem as demais. `folder`: pasta do campo (variáveis herdadas). */
    validationEnv(collectionId: EntityId | null, local: VariableLayer | null = null, folder = ''): ValidationEnv {
        const scopes = this.scopes(collectionId, folder);

        return { scopes: local ? new VariableScopes([local, ...scopes.layers.filter((layer) => layer.label !== local.label || layer.scope !== local.scope)]) : scopes, requestName: (ref) => this.findRequest(collectionId, ref)?.name ?? null };
    }

    /** Rascunho aberto (se houver) ou o arquivo em disco. */
    async definition(collectionId: EntityId, path: string): Promise<RequestDefinition> {
        return this.drafts.draft(draftKey(collectionId, path)) ?? this.files.readRequest(collectionId, path);
    }

    /** Interpola a requisição (com os headers da coleção antes dos dela: no envio o último com o mesmo nome vence). */
    prepare(collectionId: EntityId, path: string, definition: RequestDefinition, access: ResponseAccess, chain: readonly string[]): Promise<InterpolationResult> {
        const collectionHeaders = this.collections.find(collectionId)?.manifest.headers ?? [];

        const effective = this.withInheritedAuth(collectionId, path, definition);

        return interpolateRequest({ ...effective, headers: [...collectionHeaders, ...effective.headers] }, { scopes: this.scopes(collectionId, parentFolder(path)), host: this.host(collectionId, path, definition, access, chain) });
    }

    /** Implementação do `otto` (cookies, outras requisições…) usada nos templates e nos scripts. */
    host(collectionId: EntityId, path: string, definition: RequestDefinition, access: ResponseAccess, chain: readonly string[]): OttoHost {
        const collection = this.collections.find(collectionId);
        const info = this.appInfo.value();

        return {
            preview: false,
            collection: collection ? { id: collectionId, name: collection.manifest.name } : null,
            info: { environment: this.environments.selected(collectionId)?.name ?? null, workspace: this.workspaces.activeName(), appVersion: info?.version ?? '', platform: info?.platform ?? '' },
            cookies: collection
                ? {
                      list: () => this.collections.find(collectionId)?.manifest.cookies ?? [],
                      save: (cookies) => this.collections.updateManifest(collectionId, { cookies })
                  }
                : undefined,
            currentRequest: { id: definition.id ?? null, name: definition.name, path, folder: path.split('/').slice(0, -1).join('/'), method: definition.method },
            findRequest: (ref): RequestRefHandle | null => {
                const entry = this.findRequest(collectionId, ref);

                return entry
                    ? {
                          ...entry,
                          lastResponse: () => access.lastResponse(collectionId, entry.path),
                          send: () => access.sendReferenced(collectionId, entry.path, chain),
                          request: async () => {
                              const referenced = await this.definition(collectionId, entry.path);

                              return requestSnapshot((await this.prepare(collectionId, entry.path, referenced, access, [...chain, entry.path])).definition);
                          }
                      }
                    : null;
            }
        };
    }
}
