import { Component, computed, effect, inject, input, linkedSignal, signal, untracked } from '@angular/core';
import type { CollectionNode, EntityId, HttpMethod } from '@shared/models';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { TabsModule } from 'primeng/tabs';
import { TooltipModule } from 'primeng/tooltip';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { CollectionsState } from '../../core/state/collections.state';
import { EnvironmentsState } from '../../core/state/environments.state';
import { OpenApiState } from '../../core/state/openapi.state';
import { TabsState } from '../../core/state/tabs.state';
import { UiState } from '../../core/state/ui.state';
import { MethodBadge } from '../../shared/method-badge';
import { OpenApiPanel } from '../openapi/openapi-panel';
import { CollectionHeaders } from './collection-headers';

type Section = 'overview' | 'headers' | 'openapi';

interface TreeStats {
    requests: number;
    folders: number;
    invalid: number;
    methods: Map<HttpMethod, number>;
}

function stats(nodes: CollectionNode[], acc: TreeStats = { requests: 0, folders: 0, invalid: 0, methods: new Map() }): TreeStats {
    for (const node of nodes) {
        if (node.type === 'folder') {
            acc.folders++;
            stats(node.children, acc);
        } else if (node.method) {
            acc.requests++;
            acc.methods.set(node.method, (acc.methods.get(node.method) ?? 0) + 1);
        } else {
            acc.invalid++;
        }
    }

    return acc;
}

/** Página da coleção: visão geral, headers base e sincronização OpenAPI. */
@Component({
    selector: 'app-collection-overview',
    imports: [TabsModule, ButtonModule, TooltipModule, MethodBadge, CollectionHeaders, OpenApiPanel],
    template: `
        @if (collection(); as current) {
            <p-tabs [value]="section()" (valueChange)="section.set($any($event))" class="px-4 pt-2">
                <p-tablist>
                    <p-tab value="overview">Overview</p-tab>
                    <p-tab value="headers"
                        >Headers
                        @if (current.manifest.headers.length) {
                            <span class="text-xs text-muted-color">({{ current.manifest.headers.length }})</span>
                        }
                    </p-tab>
                    <p-tab value="openapi"
                        >OpenAPI
                        @if (pendingUpdates()) {
                            <span class="ml-1 rounded-full bg-amber-100 px-1.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-300">{{ pendingUpdates() }}</span>
                        }
                    </p-tab>
                </p-tablist>
                <p-tabpanels>
                    <p-tabpanel value="overview">
                        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
                            <section aria-labelledby="collection-info-heading" class="flex flex-col gap-4">
                                <h2 id="collection-info-heading" class="sr-only">Collection information</h2>
                                <div class="rounded-md border border-surface-200 p-3 dark:border-surface-700">
                                    <p class="m-0 flex items-center gap-2 text-xs font-medium text-muted-color"><i class="pi pi-folder" aria-hidden="true"></i>Location</p>
                                    <p class="m-0 mt-1 flex items-center gap-2">
                                        <span class="min-w-0 break-all font-mono text-sm">{{ current.metadata.path }}</span>
                                        <button type="button" class="otto-icon-button !h-6 !w-6 shrink-0" aria-label="Copy location" pTooltip="Copy" (click)="copy(current.metadata.path)">
                                            <i class="pi pi-copy text-xs" aria-hidden="true"></i>
                                        </button>
                                    </p>
                                </div>

                                <dl class="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
                                    @for (card of cards(); track card.label) {
                                        <div class="flex flex-col-reverse rounded-md border border-surface-200 p-3 dark:border-surface-700">
                                            <dt class="flex items-center gap-2 text-xs font-medium text-muted-color"><i [class]="card.icon" aria-hidden="true"></i>{{ card.label }}</dt>
                                            <dd class="m-0 text-2xl font-semibold">{{ card.value }}</dd>
                                        </div>
                                    }
                                </dl>

                                <div class="rounded-md border border-surface-200 p-3 dark:border-surface-700">
                                    <h3 class="m-0 mb-2 text-xs font-medium text-muted-color">Requests by method</h3>
                                    @if (methods().length) {
                                        <ul class="m-0 flex list-none flex-wrap gap-3 p-0">
                                            @for (entry of methods(); track entry.method) {
                                                <li class="flex items-center gap-2 rounded-md bg-surface-100 px-2 py-1 text-sm dark:bg-surface-800">
                                                    <app-method-badge [method]="entry.method" [compact]="true" />
                                                    <span class="font-semibold">{{ entry.count }}</span>
                                                </li>
                                            }
                                        </ul>
                                    } @else {
                                        <p class="m-0 text-sm text-muted-color">No requests yet.</p>
                                    }
                                    @if (treeStats().invalid) {
                                        <p class="m-0 mt-2 text-sm text-red-700 dark:text-red-400">{{ treeStats().invalid }} request file(s) could not be read. They are marked in the sidebar.</p>
                                    }
                                </div>

                                <dl class="m-0 grid overflow-hidden rounded-md border border-surface-200 sm:grid-cols-2 dark:border-surface-700">
                                    @for (detail of details(); track detail.label) {
                                        <div class="border-b border-surface-200 p-3 sm:odd:border-r dark:border-surface-700">
                                            <dt class="text-xs font-semibold uppercase tracking-wide text-muted-color">{{ detail.label }}</dt>
                                            <dd class="m-0 mt-1 flex items-center gap-2 text-sm">
                                                {{ detail.value }}
                                                @if (detail.action) {
                                                    <p-button [label]="detail.action" size="small" [text]="true" (onClick)="section.set(detail.target!)" />
                                                }
                                            </dd>
                                        </div>
                                    }
                                </dl>

                                <div class="flex flex-wrap gap-2">
                                    <p-button label="New Request" icon="pi pi-plus" size="small" (onClick)="ui.newRequestDialog.set({ collectionId: current.metadata.id, folder: '' })" />
                                    <p-button label="New Folder" icon="pi pi-folder-plus" size="small" severity="secondary" [outlined]="true" (onClick)="ui.newFolderDialog.set({ collectionId: current.metadata.id, folder: '' })" />
                                    <p-button label="Environments" icon="pi pi-globe" size="small" severity="secondary" [outlined]="true" (onClick)="openEnvironments()" />
                                </div>
                            </section>

                            <aside aria-labelledby="collection-docs-heading" class="flex flex-col rounded-md border border-surface-200 dark:border-surface-700">
                                <h2 id="collection-docs-heading" class="m-0 flex items-center gap-2 border-b border-surface-200 px-3 py-2 text-sm font-semibold dark:border-surface-700"><i class="pi pi-file" aria-hidden="true"></i>Documentation</h2>
                                <label for="collection-description" class="sr-only">Collection documentation</label>
                                <textarea
                                    id="collection-description"
                                    class="min-h-48 flex-1 resize-y border-0 bg-transparent p-3 text-sm text-color outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--p-primary-color)]"
                                    [value]="description()"
                                    placeholder="Describe this collection: purpose, base URLs, how to authenticate…"
                                    (input)="description.set($any($event.target).value)"
                                ></textarea>
                                @if (descriptionDirty()) {
                                    <div class="flex gap-2 border-t border-surface-200 p-2 dark:border-surface-700">
                                        <p-button label="Save" icon="pi pi-check" size="small" [loading]="savingDescription()" (onClick)="saveDescription()" />
                                        <p-button label="Discard" size="small" severity="secondary" [text]="true" (onClick)="description.set(current.manifest.description)" />
                                    </div>
                                }
                            </aside>
                        </div>
                    </p-tabpanel>
                    <p-tabpanel value="headers">
                        <app-collection-headers [collectionId]="current.metadata.id" />
                    </p-tabpanel>
                    <p-tabpanel value="openapi">
                        <app-openapi-panel [collectionId]="current.metadata.id" />
                    </p-tabpanel>
                </p-tabpanels>
            </p-tabs>
        } @else {
            <p class="m-0 p-4 text-sm text-muted-color">This collection is not open.</p>
        }
    `,
    host: { class: 'block' }
})
export class CollectionOverview {
    readonly collectionId = input.required<EntityId>();

    protected readonly ui = inject(UiState);
    private readonly collections = inject(CollectionsState);
    private readonly environments = inject(EnvironmentsState);
    private readonly openapi = inject(OpenApiState);
    private readonly tabs = inject(TabsState);
    private readonly messages = inject(MessageService);

    protected readonly section = signal<Section>('overview');
    protected readonly collection = computed(() => this.collections.find(this.collectionId()));
    protected readonly treeStats = computed(() => stats(this.collection()?.tree.children ?? []));
    protected readonly methods = computed(() => [...this.treeStats().methods].map(([method, count]) => ({ method, count })));
    protected readonly pendingUpdates = computed(() => this.openapi.pendingUpdates(this.collectionId()));
    protected readonly description = linkedSignal(() => this.collection()?.manifest.description ?? '');
    protected readonly descriptionDirty = computed(() => this.description() !== (this.collection()?.manifest.description ?? ''));
    protected readonly savingDescription = signal(false);

    protected readonly cards = computed(() => [
        { label: 'Requests', icon: 'pi pi-send', value: this.treeStats().requests },
        { label: 'Folders', icon: 'pi pi-folder', value: this.treeStats().folders },
        { label: 'Environments', icon: 'pi pi-globe', value: this.environments.list(this.collectionId()).length },
        { label: 'Headers', icon: 'pi pi-list', value: this.collection()?.manifest.headers.filter((header) => header.enabled).length ?? 0 }
    ]);

    protected readonly details = computed<Array<{ label: string; value: string; action?: string; target?: Section }>>(() => {
        const current = this.collection();
        const config = current?.manifest.openapi;
        const status = this.openapi.status(this.collectionId());

        return [
            { label: 'Name', value: current?.manifest.name ?? '' },
            { label: 'Format version', value: String(current?.manifest.version ?? '') },
            { label: 'Last opened', value: current?.metadata.lastOpenedAt ? new Date(current.metadata.lastOpenedAt).toLocaleString() : '—' },
            { label: 'Created', value: current ? new Date(current.metadata.createdAt).toLocaleDateString() : '—' },
            config
                ? { label: 'OpenAPI', value: status?.specUpdates.length ? `${status.specUpdates.length} update(s) pending` : status?.error ? 'Spec unavailable' : 'Linked', action: 'Open', target: 'openapi' }
                : { label: 'OpenAPI', value: 'Not linked', action: 'Connect', target: 'openapi' },
            { label: 'OpenAPI source', value: config?.source.location ?? '—' }
        ];
    });

    constructor() {
        effect(() => {
            const id = this.collectionId();

            untracked(() => void this.environments.load(id));
        });

        // Atende pedidos de abrir numa aba específica (ex.: botão de sync no cabeçalho).
        effect(() => {
            const request = this.ui.collectionSection();

            if (request?.collectionId === this.collectionId()) {
                untracked(() => {
                    this.section.set(request.section);
                    this.ui.collectionSection.set(null);
                });
            }
        });
    }

    protected openEnvironments(): void {
        this.tabs.open({ kind: 'environments', title: 'Environments', collectionId: this.collectionId() });
    }

    protected async saveDescription(): Promise<void> {
        this.savingDescription.set(true);

        try {
            await this.collections.updateManifest(this.collectionId(), { description: this.description() });
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not save the documentation', detail: ipcErrorMessage(error), life: 6000 });
        } finally {
            this.savingDescription.set(false);
        }
    }

    protected async copy(text: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(text);
            this.messages.add({ severity: 'info', summary: 'Copied to the clipboard', life: 2000 });
        } catch {
            // Sem acesso à área de transferência.
        }
    }
}
