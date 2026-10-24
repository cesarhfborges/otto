import { Component, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { formatResponseRef, jsonPathAll, parseResponseRef, parseSetCookie, type ResponseRef, type ResponseRefSource, type SendPolicy } from '@shared/templating';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { ResponseRefBuilderState } from '../../core/state/response-ref-builder.state';
import { responseKey, ResponsesState } from '../../core/state/responses.state';
import { TemplateContextService } from '../../core/templating/template-context.service';
import { MethodBadge } from '../../shared/method-badge';
import { suggestionsOf } from '../../shared/template-editor/completion-data';

const SOURCES: Array<{ label: string; value: ResponseRefSource }> = [
    { label: 'Body (JSONPath)', value: 'json' },
    { label: 'Header', value: 'header' },
    { label: 'Cookie', value: 'cookie' },
    { label: 'Status', value: 'status' },
    { label: 'Raw body', value: 'text' }
];

const POLICIES: Array<{ label: string; value: SendPolicy; help: string }> = [
    { label: 'Never', value: 'never', help: 'Only uses the cached response. Fails if the request was not sent yet.' },
    { label: 'When there is no cached response', value: 'empty', help: 'Sends the request once, then reuses its response.' },
    { label: 'When the cached response is older than…', value: 'expired', help: 'Sends it again after the given number of seconds (for example, a token that expires).' },
    { label: 'Always', value: 'always', help: 'Sends the referenced request before every use.' }
];

const display = (value: unknown): string => (value === undefined ? '(not found)' : typeof value === 'string' ? value : JSON.stringify(value, null, 2));

/**
 * Diálogo do construtor de referências: escolhe a requisição, o que ler da resposta e quando
 * reenviá-la; mostra o valor atual (da resposta em cache) e gera a tag `{{ otto.request(…)… }}`.
 */
@Component({
    selector: 'app-response-ref-dialog',
    imports: [FormsModule, ButtonModule, DialogModule, InputNumberModule, InputTextModule, MessageModule, SelectModule, SelectButtonModule, MethodBadge],
    template: `
        @if (builder.pending(); as pending) {
            <p-dialog
                closeAriaLabel="Close"
                [header]="pending.initial ? 'Edit Response Reference' : 'Value from Another Request'"
                appendTo="body"
                [modal]="true"
                [visible]="true"
                (visibleChange)="!$event && builder.finish(null)"
                [style]="{ width: '40rem' }"
                [breakpoints]="{ '640px': '95vw' }"
                [draggable]="false"
            >
                <form class="flex flex-col gap-5" (ngSubmit)="apply()">
                    <p class="m-0 text-sm text-muted-color">
                        Reads a value from the response of another request of this collection, without a script. Responses are cached in memory while the app is open; the send policy decides when the referenced request is sent again.
                    </p>

                    <div class="flex flex-col gap-2">
                        <label for="ref-request" class="font-medium">Request</label>
                        <p-select
                            inputId="ref-request"
                            name="request"
                            [options]="requests()"
                            optionLabel="name"
                            optionValue="ref"
                            [filter]="true"
                            filterBy="name,folder,method"
                            [ngModel]="ref().request"
                            (ngModelChange)="patch({ request: $event })"
                            placeholder="Choose a request"
                            appendTo="body"
                            class="w-full"
                        >
                            <ng-template #item let-option>
                                <span class="flex min-w-0 items-center gap-2">
                                    <app-method-badge [method]="option.method" [compact]="true" />
                                    <span class="truncate">{{ option.name }}</span>
                                    <span class="truncate text-xs text-muted-color">{{ option.folder || '/' }}</span>
                                </span>
                            </ng-template>
                        </p-select>
                    </div>

                    <div class="flex flex-col gap-2">
                        <span id="ref-source-label" class="font-medium">Read from the response</span>
                        <p-select-button name="source" [options]="sources" optionLabel="label" optionValue="value" [allowEmpty]="false" ariaLabelledBy="ref-source-label" size="small" [ngModel]="ref().source" (ngModelChange)="patch({ source: $event, argument: '' })" />
                        @if (needsArgument()) {
                            <label for="ref-argument" class="sr-only">{{ argumentLabel() }}</label>
                            <input
                                pInputText
                                id="ref-argument"
                                name="argument"
                                class="font-mono !text-sm"
                                [placeholder]="argumentPlaceholder()"
                                autocomplete="off"
                                spellcheck="false"
                                list="ref-argument-suggestions"
                                [ngModel]="ref().argument"
                                (ngModelChange)="patch({ argument: $event })"
                                aria-describedby="ref-argument-help"
                            />
                            <datalist id="ref-argument-suggestions">
                                @for (option of argumentSuggestions(); track option) {
                                    <option [value]="option"></option>
                                }
                            </datalist>
                            <small id="ref-argument-help" class="text-muted-color">{{ argumentHelp() }}</small>
                        }
                    </div>

                    <div class="flex flex-col gap-2">
                        <label for="ref-send" class="font-medium">Send the referenced request</label>
                        <div class="flex flex-wrap items-center gap-2">
                            <p-select inputId="ref-send" name="send" [options]="policies" optionLabel="label" optionValue="value" [ngModel]="ref().send" (ngModelChange)="patch({ send: $event })" appendTo="body" class="min-w-0 flex-1" ariaDescribedBy="ref-send-help" />
                            @if (ref().send === 'expired') {
                                <label for="ref-max-age" class="sr-only">Maximum age in seconds</label>
                                <p-inputnumber inputId="ref-max-age" name="maxAge" [min]="1" [max]="604800" [useGrouping]="false" suffix=" s" [ngModel]="ref().maxAge" (ngModelChange)="patch({ maxAge: $event })" inputStyleClass="w-28" />
                            }
                        </div>
                        <small id="ref-send-help" class="text-muted-color">{{ policyHelp() }}</small>
                    </div>

                    <div class="flex flex-col gap-2">
                        <label for="ref-expect" class="font-medium">Expected status <span class="font-normal text-muted-color">(optional)</span></label>
                        <input pInputText id="ref-expect" name="expect" class="w-40 font-mono !text-sm" placeholder="2xx" autocomplete="off" [ngModel]="ref().expect" (ngModelChange)="patch({ expect: $event })" aria-describedby="ref-expect-help" />
                        <small id="ref-expect-help" class="text-muted-color">Fails the request when the referenced response has another status, for example 200 or 2xx.</small>
                    </div>

                    <section class="flex flex-col gap-2 rounded-md border border-surface-200 p-3 dark:border-surface-700" aria-labelledby="ref-preview-label">
                        <div class="flex items-center gap-2">
                            <span id="ref-preview-label" class="text-sm font-medium">Current value</span>
                            <span class="text-xs text-muted-color">{{ cachedInfo() }}</span>
                            <p-button class="ms-auto" label="Send now" icon="pi pi-send" size="small" severity="secondary" [outlined]="true" [loading]="sending()" [disabled]="!selectedPath()" (onClick)="sendNow()" />
                        </div>
                        <pre class="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-100 p-2 font-mono text-xs dark:bg-surface-900" role="status">{{ previewValue() }}</pre>
                        @if (sendError(); as message) {
                            <p-message severity="error" size="small"><span role="alert">{{ message }}</span></p-message>
                        }
                    </section>

                    <div class="flex flex-col gap-1">
                        <span id="ref-tag-label" class="text-xs font-medium text-muted-color">Generated tag</span>
                        <code aria-labelledby="ref-tag-label" class="block break-all rounded bg-surface-100 p-2 text-xs dark:bg-surface-900">{{ tag() }}</code>
                    </div>
                </form>
                <ng-template #footer>
                    <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="builder.finish(null)" />
                    <p-button [label]="pending.initial ? 'Update' : 'Insert'" icon="pi pi-check" [disabled]="!valid()" (onClick)="apply()" />
                </ng-template>
            </p-dialog>
        }
    `
})
export class ResponseRefDialog {
    protected readonly builder = inject(ResponseRefBuilderState);
    private readonly templates = inject(TemplateContextService);
    private readonly responses = inject(ResponsesState);

    protected readonly sources = SOURCES;
    protected readonly policies = POLICIES;
    protected readonly sending = signal(false);
    protected readonly sendError = signal<string | null>(null);

    protected readonly requests = computed(() => {
        const pending = this.builder.pending();

        return pending
            ? this.templates
                  .requests(pending.collectionId)
                  .filter((request) => request.path !== pending.currentPath)
                  .map((request) => ({ ...request, ref: request.id ?? request.path.replace(/\.[^./]+$/, '') }))
            : [];
    });

    /** Estado do formulário: a tag em edição (se legível) ou uma nova referência. */
    protected readonly ref = linkedSignal<ResponseRef>(() => {
        const pending = this.builder.pending();

        return (pending?.initial ? parseResponseRef(pending.initial) : null) ?? { request: '', source: 'json', argument: '', send: 'empty', maxAge: 600, expect: '' };
    });

    protected readonly selectedPath = computed(() => {
        const pending = this.builder.pending();
        const ref = this.ref().request;

        return pending && ref ? (this.templates.findRequest(pending.collectionId, ref)?.path ?? null) : null;
    });
    private readonly cached = computed(() => {
        const pending = this.builder.pending();
        const path = this.selectedPath();

        // Lê o signal das respostas: atualiza depois de "Send now".
        void (pending && path && this.responses.get(responseKey(pending.collectionId, path)));

        return pending && path ? this.responses.lastResponse(pending.collectionId, path) : null;
    });

    protected readonly needsArgument = computed(() => ['json', 'header', 'cookie'].includes(this.ref().source));
    protected readonly argumentLabel = computed(() => (this.ref().source === 'json' ? 'JSONPath' : this.ref().source === 'header' ? 'Header name' : 'Cookie name'));
    protected readonly argumentPlaceholder = computed(() => (this.ref().source === 'json' ? '$.access_token' : this.ref().source === 'header' ? 'Location' : 'session'));
    protected readonly argumentHelp = computed(() =>
        this.ref().source === 'json' ? 'JSONPath of the value (first match). Empty = the whole body. Suggestions come from the cached response.' : this.ref().source === 'header' ? 'Name of the response header.' : 'Name of a cookie set by the response (Set-Cookie).'
    );
    protected readonly argumentSuggestions = computed(() => {
        const snapshot = this.cached();

        if (!snapshot) {
            return [];
        }

        const suggestions = suggestionsOf(snapshot, '');

        return this.ref().source === 'json' ? suggestions.paths.map((item) => item.path) : this.ref().source === 'header' ? suggestions.headers : suggestions.cookies;
    });
    protected readonly policyHelp = computed(() => POLICIES.find((policy) => policy.value === this.ref().send)?.help ?? '');

    protected readonly cachedInfo = computed(() => {
        const snapshot = this.cached();

        if (!this.selectedPath()) {
            return '';
        }

        return snapshot ? `status ${snapshot.status} · received ${snapshot.receivedAt ? new Date(snapshot.receivedAt).toLocaleTimeString() : ''}` : 'No cached response yet';
    });
    protected readonly previewValue = computed(() => {
        const snapshot = this.cached();
        const { source, argument } = this.ref();

        if (!this.selectedPath()) {
            return 'Choose a request.';
        }

        if (!snapshot) {
            return 'Send the request to see the value (or keep a send policy that sends it when needed).';
        }

        switch (source) {
            case 'status':
                return String(snapshot.status ?? '');
            case 'text':
                return snapshot.bodyEncoding === 'utf8' ? snapshot.body.slice(0, 5_000) : '(binary body)';
            case 'header':
                return snapshot.headers.find(([name]) => name.toLowerCase() === argument.trim().toLowerCase())?.[1] ?? '(not found)';
            case 'cookie':
                return (
                    snapshot.headers
                        .filter(([name]) => name.toLowerCase() === 'set-cookie')
                        .map(([, value]) => parseSetCookie(value))
                        .find((cookie) => cookie?.name === argument.trim())?.value ?? '(not found)'
                );
            case 'json': {
                try {
                    const body = JSON.parse(snapshot.body) as unknown;

                    return display(argument.trim() ? jsonPathAll(body, argument)[0] : body).slice(0, 5_000);
                } catch (error) {
                    return argument.trim() && snapshot.body.trim().match(/^[[{]/) ? `Invalid JSONPath: ${error instanceof Error ? error.message : String(error)}` : '(the body is not JSON)';
                }
            }
        }
    });

    protected readonly valid = computed(() => {
        const ref = this.ref();

        return !!ref.request && (!['header', 'cookie'].includes(ref.source) || !!ref.argument.trim()) && (ref.send !== 'expired' || (ref.maxAge ?? 0) > 0);
    });
    protected readonly tag = computed(() => `{{ ${formatResponseRef(this.ref())} }}`);

    constructor() {
        effect(() => {
            this.builder.pending();
            untracked(() => {
                this.sendError.set(null);
                this.sending.set(false);
            });
        });
    }

    protected patch(changes: Partial<ResponseRef>): void {
        this.ref.update((ref) => ({ ...ref, ...changes }));
    }

    protected async sendNow(): Promise<void> {
        const pending = this.builder.pending();
        const path = this.selectedPath();

        if (!pending || !path) {
            return;
        }

        this.sending.set(true);
        this.sendError.set(null);

        try {
            await this.responses.send(pending.collectionId, path, await this.templates.definition(pending.collectionId, path));
            const entry = this.responses.get(responseKey(pending.collectionId, path));

            if (entry?.status === 'done' && !entry.result.ok) {
                this.sendError.set(entry.result.error);
            }
        } catch (error) {
            this.sendError.set(ipcErrorMessage(error));
        } finally {
            this.sending.set(false);
        }
    }

    protected apply(): void {
        if (this.valid()) {
            this.builder.finish(formatResponseRef(this.ref()));
        }
    }
}
