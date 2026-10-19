import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HTTP_METHODS, type EntityId, type HttpMethod, type KeyValue, type RequestDefinition } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { TabsModule } from 'primeng/tabs';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { CollectionFilesGateway } from '../../core/ports';
import { CollectionsState } from '../../core/state/collections.state';
import { responseKey, ResponsesState } from '../../core/state/responses.state';
import { MethodBadge } from '../../shared/method-badge';
import { ResponsePanel } from './response-panel';

const AUTH_LABELS: Record<RequestDefinition['auth']['type'], string> = {
    none: 'No authentication',
    inherit: 'Inherited from the collection',
    bearer: 'Bearer token',
    basic: 'Basic authentication',
    apikey: 'API key'
};

/**
 * Aba de requisição: barra de URL, sub-abas da requisição e painel de resposta.
 * Conteúdo lido do arquivo da coleção (recarrega quando o disco muda).
 */
@Component({
    selector: 'app-request-view',
    imports: [NgTemplateOutlet, ReactiveFormsModule, TabsModule, ButtonModule, MessageModule, SelectModule, MethodBadge, ResponsePanel],
    template: `
        @if (error(); as message) {
            <p-message severity="error" styleClass="m-4"
                ><span role="alert">Could not read this request: {{ message }}</span></p-message
            >
        } @else if (request(); as req) {
            <div class="flex shrink-0 items-center gap-2 px-3 pt-3">
                <div class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-surface-200 pr-3 dark:border-surface-700" role="group" aria-label="Request URL">
                    <p-select [formControl]="methodControl" [options]="methods" ariaLabel="HTTP method" scrollHeight="none" styleClass="otto-method-select" panelStyleClass="otto-method-panel" [style]="{ width: '7.5rem' }">
                        <ng-template #selectedItem let-method>
                            <app-method-badge [method]="method" />
                        </ng-template>
                        <ng-template #item let-method>
                            <app-method-badge [method]="method" />
                        </ng-template>
                    </p-select>
                    <span class="min-w-0 flex-1 truncate font-mono text-sm" [attr.aria-label]="req.url || 'No URL'">
                        @for (part of urlParts(); track $index) {
                            <span [class]="part.variable ? 'text-primary-700 dark:text-primary-300' : ''">{{ part.text }}</span>
                        } @empty {
                            <span class="text-muted-color">No URL</span>
                        }
                    </span>
                </div>
                @if (sending()) {
                    <p-button label="Cancel" icon="pi pi-times" size="small" severity="secondary" (onClick)="cancel()" />
                } @else {
                    <p-button label="Send" icon="pi pi-send" size="small" ariaLabel="Send request (Ctrl+Enter)" (onClick)="send()" />
                }
            </div>

            @if (saveError(); as message) {
                <p-message severity="error" size="small" styleClass="mx-3 mt-2"
                    ><span role="alert">Could not change the method: {{ message }}</span></p-message
                >
            }

            <div class="grid min-h-0 flex-1 grid-cols-2">
                <div class="min-h-0 overflow-auto border-r border-surface-200 dark:border-surface-700">
                    <p-tabs value="params" class="w-full px-3" scrollable>
                        <p-tablist>
                            <p-tab value="params"
                                >Params
                                @if (req.params.length) {
                                    <span class="text-xs text-muted-color">({{ req.params.length }})</span>
                                }
                            </p-tab>
                            <p-tab value="body">Body</p-tab>
                            <p-tab value="headers"
                                >Headers
                                @if (req.headers.length) {
                                    <span class="text-xs text-muted-color">({{ req.headers.length }})</span>
                                }
                            </p-tab>
                            <p-tab value="auth">Auth</p-tab>
                            <p-tab value="docs">Docs</p-tab>
                        </p-tablist>
                        <p-tabpanels>
                            <p-tabpanel value="params">
                                <ng-container *ngTemplateOutlet="keyValues; context: { $implicit: req.params, caption: 'Query parameters', empty: 'No query parameters.' }" />
                            </p-tabpanel>
                            <p-tabpanel value="body">
                                @switch (req.body.type) {
                                    @case ('none') {
                                        <p class="m-0 text-sm text-muted-color">This request has no body.</p>
                                    }
                                    @case ('form-urlencoded') {
                                        <ng-container *ngTemplateOutlet="keyValues; context: { $implicit: req.body.fields, caption: 'Form fields', empty: 'No form fields.' }" />
                                    }
                                    @default {
                                        <p class="m-0 mb-2 text-xs font-medium uppercase text-muted-color">{{ req.body.type }}</p>
                                        <pre class="m-0 overflow-auto rounded-md bg-surface-100 p-3 font-mono text-sm dark:bg-surface-900">{{ bodyContent() }}</pre>
                                    }
                                }
                            </p-tabpanel>
                            <p-tabpanel value="headers">
                                <ng-container *ngTemplateOutlet="keyValues; context: { $implicit: req.headers, caption: 'Headers', empty: 'No headers.' }" />
                            </p-tabpanel>
                            <p-tabpanel value="auth">
                                <p class="m-0 text-sm">{{ authLabel() }}</p>
                            </p-tabpanel>
                            <p-tabpanel value="docs">
                                @if (req.docs) {
                                    <p class="m-0 whitespace-pre-wrap text-sm">{{ req.docs }}</p>
                                } @else {
                                    <p class="m-0 text-sm text-muted-color">No documentation for this request.</p>
                                }
                            </p-tabpanel>
                        </p-tabpanels>
                    </p-tabs>
                </div>
                <section aria-label="Response" class="min-h-0 overflow-auto">
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
            </div>
        } @else {
            <p class="m-0 p-4 text-sm text-muted-color" role="status">Loading…</p>
        }

        <ng-template #keyValues let-items let-caption="caption" let-empty="empty">
            @if (items.length) {
                <table class="w-full border-collapse text-sm">
                    <caption class="sr-only">
                        {{
                            caption
                        }}
                    </caption>
                    <thead>
                        <tr class="text-left text-xs text-muted-color">
                            <th scope="col" class="w-8 border-b border-surface-200 py-1.5 font-medium dark:border-surface-700"><span class="sr-only">Enabled</span></th>
                            <th scope="col" class="border-b border-surface-200 py-1.5 font-medium dark:border-surface-700">Key</th>
                            <th scope="col" class="border-b border-surface-200 py-1.5 font-medium dark:border-surface-700">Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        @for (item of asKeyValues(items); track $index) {
                            <tr [class.text-muted-color]="!item.enabled" [class.line-through]="!item.enabled">
                                <td class="border-b border-surface-100 py-1.5 dark:border-surface-800">
                                    <i class="pi text-xs" [class.pi-check-square]="item.enabled" [class.pi-stop]="!item.enabled" aria-hidden="true"></i>
                                    <span class="sr-only">{{ item.enabled ? 'Enabled' : 'Disabled' }}</span>
                                </td>
                                <td class="border-b border-surface-100 py-1.5 font-mono dark:border-surface-800">{{ item.key }}</td>
                                <td class="break-all border-b border-surface-100 py-1.5 font-mono dark:border-surface-800">{{ item.value }}</td>
                            </tr>
                        }
                    </tbody>
                </table>
            } @else {
                <p class="m-0 text-sm text-muted-color">{{ empty }}</p>
            }
        </ng-template>
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

    private readonly files = inject(CollectionFilesGateway);
    private readonly collections = inject(CollectionsState);
    private readonly responses = inject(ResponsesState);

    protected readonly request = signal<RequestDefinition | null>(null);
    protected readonly error = signal<string | null>(null);
    protected readonly saveError = signal<string | null>(null);
    protected readonly methods = [...HTTP_METHODS];
    protected readonly methodControl = new FormControl<HttpMethod>('GET', { nonNullable: true });
    protected readonly shortcuts = [
        { label: 'Send Request', keys: 'Ctrl + Enter' },
        { label: 'New Request', keys: 'Ctrl + N' },
        { label: 'Preferences', keys: 'Ctrl + ,' },
        { label: 'Toggle Theme', keys: 'Ctrl + Shift + D' }
    ];

    protected readonly urlParts = computed(() => {
        const url = this.request()?.url ?? '';

        return url
            .split(/(\{\{[^}]*\}\})/)
            .filter(Boolean)
            .map((text) => ({ text, variable: text.startsWith('{{') }));
    });

    protected readonly bodyContent = computed(() => {
        const body = this.request()?.body;

        return body && 'content' in body ? body.content : '';
    });

    private readonly key = computed(() => responseKey(this.collectionId(), this.path()));
    protected readonly response = computed(() => this.responses.get(this.key()));
    protected readonly sending = computed(() => this.response()?.status === 'sending');

    protected readonly authLabel = computed(() => AUTH_LABELS[this.request()?.auth.type ?? 'none']);

    constructor() {
        // Recarrega quando muda o arquivo aberto ou a árvore da coleção (edição externa, git pull).
        effect(() => {
            const collectionId = this.collectionId();
            const path = this.path();

            this.collections.find(collectionId)?.tree;
            untracked(() => void this.load(collectionId, path));
        });

        // O seletor reflete o arquivo; mudar o seletor grava o arquivo.
        effect(() => {
            const method = this.request()?.method;

            if (method && method !== this.methodControl.value) {
                this.methodControl.setValue(method, { emitEvent: false });
            }
        });
        this.methodControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((method) => void this.changeMethod(method));
    }

    private async changeMethod(method: HttpMethod): Promise<void> {
        const current = this.request();

        if (!current || current.method === method) {
            return;
        }

        const updated = { ...current, method };

        // Atualiza na hora; o watcher da coleção recarrega a árvore com o novo método.
        this.request.set(updated);
        this.saveError.set(null);

        try {
            await this.files.saveRequest(this.collectionId(), this.path(), updated);
        } catch (error) {
            this.request.set(current);
            this.saveError.set(ipcErrorMessage(error));
        }
    }

    protected send(): void {
        const request = this.request();

        if (request) {
            void this.responses.send(this.collectionId(), this.path(), request);
        }
    }

    protected cancel(): void {
        this.responses.cancel(this.key());
    }

    protected onSendShortcut(event: Event): void {
        event.preventDefault();

        if (this.sending()) {
            return;
        }

        this.send();
    }

    protected asKeyValues(items: unknown): KeyValue[] {
        return items as KeyValue[];
    }

    private async load(collectionId: EntityId, path: string): Promise<void> {
        try {
            const request = await this.files.readRequest(collectionId, path);

            if (collectionId === this.collectionId() && path === this.path()) {
                this.request.set(request);
                this.error.set(null);
            }
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        }
    }
}
