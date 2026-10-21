import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import type { EndpointChange, EndpointChangeKind, EntityId } from '@shared/models';
import { MessageService, type MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { MenuModule, type Menu } from 'primeng/menu';
import { MessageModule } from 'primeng/message';
import { TabsModule } from 'primeng/tabs';
import { TooltipModule } from 'primeng/tooltip';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { ConfirmState } from '../../core/state/confirm.state';
import { OpenApiState } from '../../core/state/openapi.state';
import { MethodBadge } from '../../shared/method-badge';
import { ConnectionSettingsDialog } from './connection-settings-dialog';
import { EndpointDiff } from './endpoint-diff';
import { TieredMenuModule } from 'primeng/tieredmenu';
import { Highlight } from 'ngx-highlightjs';
import { HighlightLineNumbers } from 'ngx-highlightjs/line-numbers';
import { HighlightCodeFold } from '@/app/shared/code-fold';
import { highlightLanguageFor } from '../../shared/highlight';

type Section = 'overview' | 'changes' | 'updates';

interface Group {
    kind: EndpointChangeKind;
    title: string;
    hint: string;
    items: EndpointChange[];
}

/** "há 5 min", "há 2 dias"... (em inglês, como o restante da interface). */
function relative(iso: string | null): string {
    if (!iso) {
        return 'Never';
    }

    const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);

    if (minutes < 1) {
        return 'Just now';
    }

    if (minutes < 60) {
        return `${minutes} min ago`;
    }

    const hours = Math.round(minutes / 60);

    return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

const groupBy = (changes: EndpointChange[], titles: Record<EndpointChangeKind, [string, string]>): Group[] =>
    (['added', 'modified', 'removed'] as const).map((kind) => ({ kind, title: titles[kind][0], hint: titles[kind][1], items: changes.filter((change) => change.kind === kind) })).filter((group) => group.items.length);

/**
 * Sincronização da coleção com um spec OpenAPI (inspirado no Bruno): resumo, edições
 * locais desde a última sincronização e atualizações do spec para revisar e aplicar.
 */
@Component({
    selector: 'app-openapi-panel',
    imports: [NgTemplateOutlet, TabsModule, ButtonModule, MenuModule, MessageModule, DialogModule, TooltipModule, MethodBadge, EndpointDiff, ConnectionSettingsDialog, TieredMenuModule, Highlight, HighlightLineNumbers, HighlightCodeFold],
    template: `
        @if (status(); as current) {
            @if (current.config; as config) {
                <div class="flex flex-wrap items-start gap-3">
                    <div class="min-w-0 flex-1">
                        <h2 class="m-0 text-base font-semibold">{{ current.spec?.title ?? 'OpenAPI spec' }}</h2>
                        <p class="m-0 mt-1 flex items-center gap-2 text-xs text-muted-color">
                            {{ config.source.type === 'url' ? 'Source URL:' : 'Source file:' }}
                            <code class="truncate text-color">{{ config.source.location }}</code>
                            <button type="button" class="otto-icon-button !h-6 !w-6" aria-label="Copy source" pTooltip="Copy" (click)="copy(config.source.location)">
                                <i class="pi pi-copy text-xs" aria-hidden="true"></i>
                            </button>
                        </p>
                    </div>
                    <p-button label="Check for updates" icon="pi pi-sync" size="small" severity="secondary" [outlined]="true" [loading]="busy()" (onClick)="check()" />
                    <p-button label="View spec" icon="pi pi-file" size="small" severity="secondary" [outlined]="true" [disabled]="!current.spec" (onClick)="viewSpec()" />
                    <button type="button" class="otto-icon-button" aria-label="More OpenAPI actions" aria-haspopup="menu" (click)="moreMenu.toggle($event)">
                        <i class="pi pi-ellipsis-v" aria-hidden="true"></i>
                    </button>
                    <p-tiered-menu #moreMenu [model]="moreItems" [popup]="true" appendTo="body" />
                </div>

                <p-tabs [value]="section()" (valueChange)="section.set($any($event))" class="mt-3">
                    <p-tablist>
                        <p-tab value="overview">Overview</p-tab>
                        <p-tab value="changes"
                            >Collection Changes
                            @if (current.collectionChanges.length) {
                                <span class="ml-1 rounded-full bg-surface-200 px-1.5 text-xs dark:bg-surface-700">{{ current.collectionChanges.length }}</span>
                            }
                        </p-tab>
                        <p-tab value="updates"
                            >Spec Updates
                            @if (current.specUpdates.length) {
                                <span class="ml-1 rounded-full bg-surface-200 px-1.5 text-xs dark:bg-surface-700">{{ current.specUpdates.length }}</span>
                            }
                        </p-tab>
                    </p-tablist>
                    <p-tabpanels>
                        <p-tabpanel value="overview">
                            @if (current.error) {
                                <p-message severity="error" styleClass="mb-4"
                                    ><span role="alert">{{ current.error }}</span></p-message
                                >
                            } @else if (current.specUpdates.length || current.collectionChanges.length) {
                                <div class="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40" role="status">
                                    <div class="min-w-0 flex-1">
                                        <p class="m-0 text-sm font-medium text-amber-900 dark:text-amber-300">{{ bannerTitle() }}</p>
                                        <p class="m-0 text-sm text-muted-color">{{ bannerText() }}</p>
                                    </div>
                                    @if (current.collectionChanges.length) {
                                        <p-button label="View Collection Changes" size="small" severity="secondary" [outlined]="true" (onClick)="section.set('changes')" />
                                    }
                                    @if (current.specUpdates.length) {
                                        <p-button label="Review and Sync Collection" size="small" (onClick)="section.set('updates')" />
                                    }
                                </div>
                            } @else if (current.spec) {
                                <p-message severity="success" styleClass="mb-4"><span role="status">The collection is in sync with the spec.</span></p-message>
                            }

                            <h3 class="m-0 mb-2 text-sm font-semibold">Endpoint summary</h3>
                            <dl class="m-0 grid grid-cols-2 gap-3 lg:grid-cols-4">
                                @for (card of cards(); track card.label) {
                                    <div class="flex flex-col-reverse rounded-md border border-surface-200 p-3 dark:border-surface-700" [title]="card.hint">
                                        <dt class="text-sm text-muted-color">{{ card.label }}</dt>
                                        <dd class="m-0 text-2xl font-semibold" [class]="card.color">{{ card.value }}</dd>
                                    </div>
                                }
                            </dl>

                            <h3 class="m-0 mb-2 mt-5 text-sm font-semibold">Last synced spec details</h3>
                            <dl class="m-0 grid overflow-hidden rounded-md border border-surface-200 sm:grid-cols-3 dark:border-surface-700">
                                @for (detail of details(); track detail.label) {
                                    <div class="border-b border-surface-200 p-3 sm:border-r dark:border-surface-700">
                                        <dt class="text-xs font-semibold uppercase tracking-wide text-muted-color">{{ detail.label }}</dt>
                                        <dd class="m-0 mt-1 text-sm">{{ detail.value }}</dd>
                                    </div>
                                }
                            </dl>
                        </p-tabpanel>

                        <p-tabpanel value="changes">
                            @if (current.collectionChanges.length) {
                                <div class="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-surface-200 p-3 dark:border-surface-700">
                                    <p class="m-0 flex-1 text-sm font-medium">Collection has changes since the last sync</p>
                                    <p-button label="Revert All to Spec" severity="danger" [text]="true" size="small" (onClick)="revertAll()" />
                                </div>
                                <p class="m-0 mb-3 text-sm text-muted-color"><strong>What's tracked:</strong> changes to method, URL, parameters, headers, body and auth compared to the last synced spec. Names and docs are not tracked.</p>
                                @for (group of changeGroups(); track group.kind) {
                                    <ng-container *ngTemplateOutlet="changeList; context: { $implicit: group, mode: 'changes' }" />
                                }
                            } @else {
                                <p class="m-0 text-sm text-muted-color">No changes in the collection since the last sync.</p>
                            }
                        </p-tabpanel>

                        <p-tabpanel value="updates">
                            @if (current.specUpdates.length) {
                                <div class="mb-3 flex flex-wrap items-center gap-2">
                                    <div class="min-w-0 flex-1">
                                        <p class="m-0 text-sm font-semibold">Review changes</p>
                                        <p class="m-0 text-sm text-muted-color">Accept the endpoints to update. Accepted requests are replaced completely by the spec version.</p>
                                    </div>
                                    <p-button label="Skip All" icon="pi pi-times" size="small" severity="secondary" [outlined]="true" (onClick)="skipAll()" />
                                    <p-button label="Accept All" icon="pi pi-check" size="small" severity="secondary" [outlined]="true" (onClick)="acceptAll()" />
                                </div>
                                @for (group of updateGroups(); track group.kind) {
                                    <ng-container *ngTemplateOutlet="changeList; context: { $implicit: group, mode: 'updates' }" />
                                }
                                <p class="m-0 mt-3 text-sm text-muted-color"><strong>What gets updated:</strong> method, URL, parameters, headers, body and auth. Skipped endpoints stay pending for the next sync.</p>
                                <div class="mt-4 flex justify-end">
                                    <p-button [label]="'Sync Collection (' + accepted().size + ')'" icon="pi pi-arrow-right" iconPos="right" [disabled]="!accepted().size" [loading]="busy()" (onClick)="sync()" />
                                </div>
                            } @else {
                                <p class="m-0 text-sm text-muted-color">{{ current.spec ? 'No updates in the spec. Use Check for updates to fetch it again.' : 'The spec could not be read. See the Overview tab.' }}</p>
                            }
                        </p-tabpanel>
                    </p-tabpanels>
                </p-tabs>

                <ng-template #changeList let-group let-mode="mode">
                    <section class="mb-3 overflow-hidden rounded-md border border-surface-200 dark:border-surface-700" [attr.aria-label]="group.title">
                        <header class="flex items-center gap-2 bg-surface-50 px-3 py-2 dark:bg-surface-900">
                            <span class="text-sm font-semibold">{{ group.title }}</span>
                            <span class="rounded-full bg-surface-200 px-1.5 text-xs dark:bg-surface-700">{{ group.items.length }}</span>
                            <span class="text-xs text-muted-color">{{ group.hint }}</span>
                        </header>
                        <ul class="m-0 list-none p-0">
                            @for (change of group.items; track change.key) {
                                <li class="border-t border-surface-200 dark:border-surface-700">
                                    <div class="flex items-center gap-2 px-3 py-2">
                                        <button
                                            type="button"
                                            class="otto-icon-button"
                                            [attr.aria-expanded]="expanded().has(mode + change.key)"
                                            [attr.aria-label]="(expanded().has(mode + change.key) ? 'Hide' : 'Show') + ' differences for ' + change.key"
                                            (click)="toggle(mode + change.key)"
                                        >
                                            <i class="pi text-xs" [class.pi-chevron-down]="expanded().has(mode + change.key)" [class.pi-chevron-right]="!expanded().has(mode + change.key)" aria-hidden="true"></i>
                                        </button>
                                        <app-method-badge [method]="change.method" [compact]="true" />
                                        <code class="min-w-0 truncate text-sm">{{ change.path }}</code>
                                        @if (change.operationId) {
                                            <span class="truncate text-xs text-muted-color">{{ change.operationId }}</span>
                                        }
                                        <span class="ml-auto flex gap-1">
                                            @if (mode === 'updates') {
                                                <p-button
                                                    label="Skip"
                                                    icon="pi pi-times"
                                                    size="small"
                                                    severity="secondary"
                                                    [text]="!accepted().has(change.key)"
                                                    [outlined]="accepted().has(change.key)"
                                                    [ariaLabel]="'Skip ' + change.key"
                                                    (onClick)="setAccepted(change.key, false)"
                                                />
                                                <p-button
                                                    [label]="acceptLabel(change.kind)"
                                                    icon="pi pi-check"
                                                    size="small"
                                                    [severity]="accepted().has(change.key) ? 'primary' : 'secondary'"
                                                    [outlined]="!accepted().has(change.key)"
                                                    [attr.aria-pressed]="accepted().has(change.key)"
                                                    [ariaLabel]="acceptLabel(change.kind) + ' ' + change.key"
                                                    (onClick)="setAccepted(change.key, true)"
                                                />
                                            } @else {
                                                <p-button label="Reset" icon="pi pi-undo" size="small" severity="secondary" [outlined]="true" [ariaLabel]="'Reset ' + change.key + ' to the spec'" (onClick)="revert([change.key])" />
                                            }
                                        </span>
                                    </div>
                                    @if (expanded().has(mode + change.key)) {
                                        <app-endpoint-diff
                                            class="px-3 pb-3"
                                            [before]="change.before"
                                            [after]="change.after"
                                            [leftLabel]="mode === 'updates' ? 'Current (in collection)' : 'Last synced spec'"
                                            [rightLabel]="mode === 'updates' ? 'Expected (from spec)' : 'Current (in collection)'"
                                        />
                                    }
                                </li>
                            }
                        </ul>
                    </section>
                </ng-template>
            } @else {
                <div class="flex flex-col items-center gap-3 rounded-md border border-dashed border-surface-300 p-8 text-center dark:border-surface-700">
                    <i class="pi pi-sync !text-3xl text-muted-color" aria-hidden="true"></i>
                    <p class="m-0 font-medium">Not linked to an OpenAPI spec</p>
                    <p class="m-0 max-w-lg text-sm text-muted-color">Link this collection to an OpenAPI 3 or Swagger 2 spec (URL or file). New and changed endpoints are shown for review before anything in the collection changes.</p>
                    <p-button label="Connect to OpenAPI Spec" icon="pi pi-link" (onClick)="settingsOpen.set(true)" />
                </div>
            }
            <!-- Uma instância só: ao conectar, a tela troca de ramo e o diálogo não pode renascer aberto. -->
            <app-connection-settings-dialog [collectionId]="collectionId()" [config]="current.config" [(visible)]="settingsOpen" />
        } @else {
            <p class="m-0 text-sm text-muted-color" role="status">Loading…</p>
        }

        <p-dialog closeAriaLabel="Close" header="OpenAPI Spec" [modal]="true" [(visible)]="specOpen" [style]="{ width: 'min(60rem, 90vw)' }" [draggable]="false" appendTo="body">
            <pre
                class="m-0 h-[65vh] overflow-auto whitespace-pre rounded-md border border-surface bg-surface-50 p-3 font-mono text-xs leading-relaxed dark:bg-surface-900"
                tabindex="0"
                aria-label="Spec content"
            >@if (specHighlighted()) {<code [highlight]="specText()" language="json" ignoreIllegals lineNumbers codeFold="json"></code>} @else {<code>{{ specText() }}</code>}</pre>
        </p-dialog>
    `,
    host: { class: 'block' }
})
export class OpenApiPanel {
    readonly collectionId = input.required<EntityId>();

    private readonly openapi = inject(OpenApiState);
    private readonly confirm = inject(ConfirmState);
    private readonly messages = inject(MessageService);
    private readonly moreMenu = viewChild<Menu>('moreMenu');

    protected readonly section = signal<Section>('overview');
    protected readonly accepted = signal<ReadonlySet<string>>(new Set());
    protected readonly expanded = signal<ReadonlySet<string>>(new Set());
    protected readonly settingsOpen = signal(false);
    protected readonly specOpen = signal(false);
    protected readonly specText = signal('');
    /** Realce só para JSON de tamanho razoável; YAML e specs enormes ficam em texto puro. */
    protected readonly specHighlighted = computed(() => highlightLanguageFor(this.specText(), 'json') !== null && isJson(this.specText()));

    protected readonly status = computed(() => this.openapi.status(this.collectionId()));
    protected readonly busy = computed(() => this.openapi.isBusy(this.collectionId()));

    protected readonly moreItems: MenuItem[] = [
        { label: 'Edit connection settings', icon: 'pi pi-cog', command: () => this.settingsOpen.set(true) },
        { label: 'Disconnect Sync', icon: 'pi pi-link', styleClass: 'otto-danger-item', command: () => void this.disconnect() }
    ];

    protected readonly updateGroups = computed(() =>
        groupBy(this.status()?.specUpdates ?? [], {
            added: ['New in Spec', 'New endpoints from the spec'],
            modified: ['Modified in Spec', 'Endpoints changed in the spec'],
            removed: ['Removed from Spec', 'Endpoints no longer in the spec (accepting deletes the request)']
        })
    );
    protected readonly changeGroups = computed(() =>
        groupBy(this.status()?.collectionChanges ?? [], { added: ['Added', ''], modified: ['Modified in Collection', 'Edited since the last sync'], removed: ['Deleted in Collection', 'Removed from the collection since the last sync'] })
    );

    protected readonly bannerTitle = computed(() => {
        const status = this.status();
        const updates = !!status?.specUpdates.length;
        const changes = !!status?.collectionChanges.length;

        return updates && changes ? 'OpenAPI spec has new updates and the collection has changes' : updates ? 'OpenAPI spec has new updates' : 'The collection has changes since the last sync';
    });

    protected readonly bannerText = computed(() => {
        const status = this.status();

        return status?.specUpdates.length && status.collectionChanges.length
            ? 'New or changed requests are available. Some collection changes may be overwritten.'
            : status?.specUpdates.length
              ? 'New or changed requests are available for review.'
              : 'Requests were edited locally. You can keep them or reset them to the spec.';
    });

    protected readonly cards = computed(() => {
        const status = this.status();

        return [
            { label: 'Total in collection', value: status?.linkedRequests ?? 0, color: 'text-blue-700 dark:text-blue-300', hint: 'Requests in the collection linked to spec operations' },
            { label: 'In sync with spec', value: status?.inSync ?? 0, color: 'text-green-700 dark:text-green-300', hint: 'Linked requests identical to the last synced spec, with no pending updates' },
            { label: 'Changed in collection', value: status?.collectionChanges.length ?? 0, color: 'text-color', hint: 'Requests edited or deleted since the last sync' },
            { label: 'Spec updates pending', value: status?.specUpdates.length ?? 0, color: 'text-amber-800 dark:text-amber-300', hint: 'New, changed or removed endpoints in the spec' }
        ];
    });

    protected readonly details = computed(() => {
        const status = this.status();
        const config = status?.config;

        return [
            { label: 'Spec version', value: status?.spec?.version || '—' },
            { label: 'Endpoints in spec', value: String(status?.spec?.endpointCount ?? '—') },
            { label: 'Last synced at', value: relative(status?.lastSyncedAt ?? null) },
            { label: 'Synced spec version', value: status?.syncedSpecVersion || '—' },
            { label: 'Folder grouping', value: config?.groupBy === 'path' ? 'Path' : 'Tags' },
            { label: 'Auto check for updates', value: config?.autoCheck ? `Every ${config.intervalMinutes} min` : 'Off' },
            { label: 'Last checked', value: relative(status?.lastCheckedAt ?? null) },
            { label: 'Format', value: status?.spec ? (status.spec.format.startsWith('2') ? `Swagger ${status.spec.format}` : `OpenAPI ${status.spec.format}`) : '—' },
            { label: 'Servers', value: status?.spec?.servers.join(', ') || '—' }
        ];
    });

    constructor() {
        // Carrega (sem buscar de novo se já houver verificação recente) ao abrir a coleção.
        effect(() => {
            const id = this.collectionId();

            untracked(() => void this.openapi.load(id));
        });

        // Itens que não existem mais saem da seleção.
        effect(() => {
            const keys = new Set((this.status()?.specUpdates ?? []).map((change) => change.key));

            untracked(() => this.accepted.update((set) => new Set([...set].filter((key) => keys.has(key)))));
        });
    }

    protected acceptLabel(kind: EndpointChangeKind): string {
        return kind === 'added' ? 'Add' : kind === 'removed' ? 'Remove' : 'Update';
    }

    protected toggle(id: string): void {
        this.expanded.update((set) => {
            const next = new Set(set);

            if (!next.delete(id)) {
                next.add(id);
            }

            return next;
        });
    }

    protected setAccepted(key: string, accept: boolean): void {
        this.accepted.update((set) => {
            const next = new Set(set);

            if (accept) {
                next.add(key);
            } else {
                next.delete(key);
            }

            return next;
        });
    }

    protected skipAll(): void {
        this.accepted.set(new Set());
    }

    protected acceptAll(): void {
        this.accepted.set(new Set((this.status()?.specUpdates ?? []).map((change) => change.key)));
    }

    protected check(): void {
        void this.openapi.load(this.collectionId(), true);
    }

    protected async viewSpec(): Promise<void> {
        try {
            this.specText.set(prettySpec(await this.openapi.spec(this.collectionId())));
            this.specOpen.set(true);
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not read the spec', detail: ipcErrorMessage(error), life: 6000 });
        }
    }

    protected async sync(): Promise<void> {
        const keys = [...this.accepted()];

        try {
            await this.openapi.sync(this.collectionId(), keys);
            this.accepted.set(new Set());
            this.messages.add({ severity: 'success', summary: 'Collection synced', detail: `${keys.length} endpoint${keys.length === 1 ? '' : 's'} updated from the spec.`, life: 4000 });
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not sync the collection', detail: ipcErrorMessage(error), life: 6000 });
        }
    }

    protected async revert(keys: string[]): Promise<void> {
        try {
            await this.openapi.revert(this.collectionId(), keys);
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not reset the requests', detail: ipcErrorMessage(error), life: 6000 });
        }
    }

    protected async revertAll(): Promise<void> {
        const keys = (this.status()?.collectionChanges ?? []).map((change) => change.key);
        const accepted = await this.confirm.ask({
            header: 'Revert All to Spec',
            message: `Replace ${keys.length} edited request${keys.length === 1 ? '' : 's'} with the last synced spec version? Local edits are lost.`,
            acceptLabel: 'Revert All',
            severity: 'danger'
        });

        if (accepted) {
            await this.revert(keys);
        }
    }

    protected async copy(text: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(text);
            this.messages.add({ severity: 'info', summary: 'Copied to the clipboard', life: 2000 });
        } catch {
            // Sem acesso à área de transferência: nada a fazer.
        }
    }

    private async disconnect(): Promise<void> {
        const accepted = await this.confirm.ask({ header: 'Disconnect Sync', message: 'Stop syncing this collection with the OpenAPI spec? Requests already in the collection are kept.', acceptLabel: 'Disconnect', severity: 'danger' });

        if (accepted) {
            await this.openapi.disconnect(this.collectionId());
            this.moreMenu()?.hide();
        }
    }
}

/** Indenta a spec quando é JSON (costuma vir minificada); outros formatos (YAML) ficam como vieram. */
function prettySpec(text: string): string {
    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
        return text;
    }
}

function isJson(text: string): boolean {
    const start = text.trimStart()[0];
    return start === '{' || start === '[';
}
