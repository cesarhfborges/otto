import { Component, computed, effect, inject, input, linkedSignal, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { type EntityId, hasBody, HTTP_METHODS, type HttpMethod, type RequestDefinition } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { SplitterModule } from 'primeng/splitter';
import { TabsModule } from 'primeng/tabs';
import type { SplitterPassThrough, SplitterResizeEndEvent } from 'primeng/types/splitter';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { CollectionFilesGateway } from '../../core/ports';
import { CollectionsState } from '../../core/state/collections.state';
import { draftKey, RequestDraftsState } from '../../core/state/request-drafts.state';
import { responseKey, ResponsesState } from '../../core/state/responses.state';
import { SettingsState } from '../../core/state/settings.state';
import { MethodBadge } from '../../shared/method-badge';
import { AuthEditor } from './auth-editor';
import { BodyEditor } from './body-editor';
import { KeyValueEditor } from './key-value-editor';
import { ResponsePanel } from './response-panel';

const REQUEST_SPLITTER_KEY = 'otto.splitter.request';

type Section = 'params' | 'body' | 'headers' | 'auth' | 'docs';

/** Primeiro tamanho (%) salvo pelo `stateKey` do splitter; `localStorage` pode estar indisponível. */
function savedSplitterSize(key: string, fallback: number): number {
    try {
        const sizes: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');

        return Array.isArray(sizes) && typeof sizes[0] === 'number' ? sizes[0] : fallback;
    } catch {
        return fallback;
    }
}

const enabledCount = (items: ReadonlyArray<{ enabled: boolean; key: string }>): number => items.filter((item) => item.enabled && item.key.trim()).length;

/**
 * Editor da requisição: método, URL, params, body, headers, auth e docs, com o painel
 * de resposta ao lado. As edições ficam num rascunho (sobrevive à troca de abas) e são
 * gravadas no arquivo da coleção com Save / Ctrl+S. O envio usa o rascunho atual.
 */
@Component({
    selector: 'app-request-view',
    imports: [ReactiveFormsModule, TabsModule, ButtonModule, InputTextModule, MessageModule, SelectModule, SplitterModule, MethodBadge, KeyValueEditor, BodyEditor, AuthEditor, ResponsePanel],
    template: `
        @if (error(); as message) {
            <p-message severity="error" styleClass="m-4"
                ><span role="alert">Could not read this request: {{ message }}</span></p-message
            >
        } @else if (request(); as req) {
            <div class="flex shrink-0 items-center gap-2 px-3 pt-3">
                <div class="flex h-9 min-w-0 flex-1 items-center rounded-md border border-surface-200 dark:border-surface-700" role="group" aria-label="Request line">
                    <p-select [formControl]="methodControl" [options]="methods" ariaLabel="HTTP method" scrollHeight="none" styleClass="otto-method-select" panelStyleClass="otto-method-panel" [style]="{ width: '7.5rem' }">
                        <ng-template #selectedItem let-method>
                            <app-method-badge [method]="method" />
                        </ng-template>
                        <ng-template #item let-method>
                            <app-method-badge [method]="method" />
                        </ng-template>
                    </p-select>
                    <input
                        class="h-full min-w-0 flex-1 border-0 bg-transparent px-3 font-mono text-sm text-color outline-none placeholder:text-muted-color focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--p-primary-color)]"
                        [value]="req.url"
                        placeholder="https://api.example.com/users or {{ urlExample }}"
                        aria-label="Request URL"
                        autocomplete="off"
                        spellcheck="false"
                        (input)="update({ url: $any($event.target).value })"
                    />
                </div>
                <p-button label="Save" icon="pi pi-save" size="small" severity="secondary" [outlined]="true" [disabled]="!dirty()" [loading]="saving()" ariaLabel="Save request (Ctrl+S)" (onClick)="save()" />
                @if (sending()) {
                    <p-button label="Cancel" icon="pi pi-times" size="small" severity="secondary" (onClick)="cancel()" />
                } @else {
                    <p-button label="Send" icon="pi pi-send" size="small" ariaLabel="Send request (Ctrl+Enter)" (onClick)="send()" />
                }
            </div>

            @if (saveError(); as message) {
                <p-message severity="error" size="small" styleClass="mx-3 mt-2"
                    ><span role="alert">Could not save: {{ message }}</span></p-message
                >
            }

            <!--
                Requisição × resposta redimensionável; o tamanho fica salvo (localStorage), um por layout.
                O PrimeNG calcula direção e tamanhos ao iniciar: o @for recria o splitter quando o layout muda.
            -->
            @for (layout of [panelSplitterDir()]; track layout) {
                <p-splitter
                    [pt]="splitterPt()"
                    [panelSizes]="splitterSizes"
                    [minSizes]="[25, 25]"
                    [stateKey]="splitterStateKey()"
                    stateStorage="local"
                    (onResizeEnd)="requestSize.set(firstSize($event))"
                    class="mt-2 min-h-0 flex-1"
                    [layout]="layout"
                    styleClass="h-full !rounded-none !border-0 !bg-transparent [&>.p-splitterpanel]:min-h-0 [&>.p-splitterpanel]:min-w-0 [&>.p-splitterpanel]:overflow-hidden"
                >
                    <ng-template #panel>
                        <div class="flex h-full w-full flex-col overflow-auto">
                            <p-tabs [value]="section()" (valueChange)="section.set($any($event))" class="flex min-h-0 w-full flex-1 flex-col px-3" scrollable>
                                <p-tablist>
                                    <p-tab value="params"
                                        >Params
                                        @if (counts().params) {
                                            <span class="text-xs text-muted-color">({{ counts().params }})</span>
                                        }
                                    </p-tab>
                                    @if (bodyAllowed()) {
                                        <p-tab value="body"
                                            >Body
                                            @if (req.body.type !== 'none') {
                                                <span class="text-xs text-muted-color">•</span>
                                            }
                                        </p-tab>
                                    }
                                    <p-tab value="headers"
                                        >Headers
                                        @if (counts().headers) {
                                            <span class="text-xs text-muted-color">({{ counts().headers }})</span>
                                        }
                                    </p-tab>
                                    <p-tab value="auth"
                                        >Auth
                                        @if (req.auth.type !== 'none') {
                                            <span class="text-xs text-muted-color">•</span>
                                        }
                                    </p-tab>
                                    <p-tab value="docs">Docs</p-tab>
                                </p-tablist>
                                <p-tabpanels class="flex min-h-0 flex-1 flex-col">
                                    <p-tabpanel value="params">
                                        <app-key-value-editor [items]="req.params" (itemsChange)="update({ params: $event })" label="Query parameters" addLabel="Add Param" />
                                        <p class="m-0 mt-2 text-xs text-muted-color">Enabled params are appended to the URL query string when the request is sent.</p>
                                    </p-tabpanel>
                                    @if (bodyAllowed()) {
                                        <!-- Ativo vira flex para o editor ocupar a altura restante (inativo segue com [hidden]). -->
                                        <p-tabpanel value="body" class="min-h-0 flex-1 flex-col data-[p-active=true]:flex">
                                            <app-body-editor [body]="req.body" (bodyChange)="update({ body: $event })" />
                                        </p-tabpanel>
                                    }
                                    <p-tabpanel value="headers">
                                        <app-key-value-editor [items]="req.headers" (itemsChange)="update({ headers: $event })" label="Headers" addLabel="Add Header" />
                                    </p-tabpanel>
                                    <p-tabpanel value="auth">
                                        <app-auth-editor [auth]="req.auth" (authChange)="update({ auth: $event })" />
                                    </p-tabpanel>
                                    <p-tabpanel value="docs">
                                        <label for="request-docs" class="mb-2 block text-sm font-medium">Documentation (Markdown)</label>
                                        <textarea
                                            id="request-docs"
                                            class="min-h-48 w-full resize-y rounded-md border border-surface-300 bg-surface-0 p-3 text-sm text-color focus-visible:outline-2 focus-visible:outline-[var(--p-primary-color)] dark:border-surface-700 dark:bg-surface-950"
                                            [value]="req.docs"
                                            placeholder="Describe what this request does, its parameters and expected responses."
                                            (input)="update({ docs: $any($event.target).value })"
                                        ></textarea>
                                    </p-tabpanel>
                                </p-tabpanels>
                            </p-tabs>
                        </div>
                    </ng-template>

                    <ng-template #panel>
                        <section aria-label="Response" class="h-full w-full overflow-auto">
                            @if (response(); as entry) {
                                <app-response-panel [entry]="entry" />
                            } @else {
                                <div class="flex h-full w-full flex-col items-center justify-center gap-6 p-6 text-center">
                                    <i class="pi pi-send !text-6xl text-surface-300 dark:text-surface-600" aria-hidden="true"></i>
                                    <dl class="m-0 grid grid-cols-[auto_auto] gap-x-6 gap-y-2 text-sm">
                                        @for (shortcut of shortcuts; track shortcut.label) {
                                            <dt class="text-right text-muted-color">{{ shortcut.label }}</dt>
                                            <dd class="m-0 text-left">
                                                <kbd class="font-sans">{{ shortcut.keys }}</kbd>
                                            </dd>
                                        }
                                    </dl>
                                </div>
                            }
                        </section>
                    </ng-template>
                </p-splitter>
            }
        } @else {
            <p class="m-0 p-4 text-sm text-muted-color" role="status">Loading…</p>
        }
    `,
    host: {
        class: 'flex h-full min-h-0 flex-col',
        '(document:keydown.control.enter)': 'onSendShortcut($event)',
        '(document:keydown.meta.enter)': 'onSendShortcut($event)'
    }
})
export class RequestView {
    readonly collectionId = input.required<EntityId>();
    readonly path = input.required<string>();
    private readonly settings = inject(SettingsState);
    private readonly files = inject(CollectionFilesGateway);
    private readonly collections = inject(CollectionsState);
    private readonly responses = inject(ResponsesState);
    private readonly drafts = inject(RequestDraftsState);

    /** Layout escolhido em Preferences → Appearance. */
    protected readonly panelSplitterDir = computed(() => this.settings.settings().appearance.requestLayout);
    protected readonly splitterStateKey = computed(() => `${REQUEST_SPLITTER_KEY}.${this.panelSplitterDir()}`);
    protected readonly splitterSizes = [50, 50];
    /** Largura do painel da requisição (%), para o `aria-valuenow` do divisor. */
    protected readonly requestSize = linkedSignal(() => savedSplitterSize(this.splitterStateKey(), this.splitterSizes[0]!));
    protected readonly firstSize = (event: SplitterResizeEndEvent): number => Number(event.sizes[0]);
    /** O puxador (focável, responde às setas) é o separador acessível; ver `Shell`. */
    protected readonly splitterPt = computed<SplitterPassThrough>(() => ({
        panel: {},
        gutter: { role: 'none' },
        gutterHandle: {
            role: 'separator',
            'aria-label': 'Resize request and response panels',
            'aria-orientation': this.panelSplitterDir() === 'horizontal' ? 'vertical' : 'horizontal',
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': Math.round(this.requestSize())
        }
    }));

    private readonly key = computed(() => draftKey(this.collectionId(), this.path()));
    protected readonly request = computed(() => this.drafts.draft(this.key()));
    protected readonly dirty = computed(() => this.drafts.isDirty(this.key()));
    protected readonly error = signal<string | null>(null);
    protected readonly saveError = signal<string | null>(null);
    protected readonly saving = signal(false);
    protected readonly methods = [...HTTP_METHODS];
    protected readonly methodControl = new FormControl<HttpMethod>('GET', { nonNullable: true });
    protected readonly urlExample = '{{baseUrl}}/users';
    protected readonly shortcuts = [
        { label: 'Send Request', keys: 'Ctrl + Enter' },
        { label: 'Save Request', keys: 'Ctrl + S' },
        { label: 'New Request', keys: 'Ctrl + N' },
        { label: 'Preferences', keys: 'Ctrl + ,' }
    ];
    /** GET, HEAD, TRACE e CONNECT não levam corpo: a aba Body some. */
    protected readonly bodyAllowed = computed(() => hasBody(this.request()?.method ?? 'GET'));
    /** Aba inicial: Body quando o método aceita corpo, senão Params; volta ao padrão ao trocar de request ou de método com/sem corpo. */
    protected readonly section = linkedSignal<{ key: string; bodyAllowed: boolean }, Section>({
        source: () => ({ key: this.key(), bodyAllowed: this.bodyAllowed() }),
        computation: ({ bodyAllowed }) => (bodyAllowed ? 'body' : 'params')
    });
    protected readonly counts = computed(() => {
        const request = this.request();

        return { params: request ? enabledCount(request.params) : 0, headers: request ? enabledCount(request.headers) : 0 };
    });
    protected readonly response = computed(() => this.responses.get(responseKey(this.collectionId(), this.path())));
    protected readonly sending = computed(() => this.response()?.status === 'sending');

    constructor() {
        // Lê o arquivo ao abrir e quando a árvore da coleção muda (edição externa, git pull);
        // alterações locais não salvas são mantidas.
        effect(() => {
            const collectionId = this.collectionId();
            const path = this.path();

            this.collections.find(collectionId)?.tree;
            untracked(() => void this.load(collectionId, path));
        });

        effect(() => {
            const method = this.request()?.method;

            if (method && method !== this.methodControl.value) {
                this.methodControl.setValue(method, { emitEvent: false });
            }
        });
        this.methodControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((method) => this.update({ method }));
    }

    protected update(changes: Partial<RequestDefinition>): void {
        this.drafts.update(this.key(), (draft) => ({ ...draft, ...changes }));
    }

    protected async save(): Promise<void> {
        this.saving.set(true);
        this.saveError.set(null);

        try {
            await this.drafts.save(this.collectionId(), this.path());
        } catch (error) {
            this.saveError.set(ipcErrorMessage(error));
        } finally {
            this.saving.set(false);
        }
    }

    protected send(): void {
        const request = this.request();

        if (request) {
            void this.responses.send(this.collectionId(), this.path(), request);
        }
    }

    protected cancel(): void {
        this.responses.cancel(responseKey(this.collectionId(), this.path()));
    }

    protected onSendShortcut(event: Event): void {
        event.preventDefault();

        if (!this.sending()) {
            this.send();
        }
    }

    private async load(collectionId: EntityId, path: string): Promise<void> {
        try {
            const request = await this.files.readRequest(collectionId, path);

            this.drafts.loaded(draftKey(collectionId, path), request);
            this.error.set(null);
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        }
    }
}
