import { Component, computed, input, linkedSignal, output } from '@angular/core';
import type { HttpResponse } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TabsModule } from 'primeng/tabs';
import type { ResponseEntry } from '../../core/state/responses.state';
import { formatBytes, formatDuration } from '../../shared/format';
import { type HighlightLanguage, highlightLanguageFor } from '../../shared/highlight';
import { errorHelp } from './error-hints';
import { ResponseConsole } from './response-console';
import { CodeEditor } from '@/app/shared/code-editor';

/** Acima disso o corpo é exibido parcialmente (o visualizador completo chega na Etapa 7). */
const MAX_DISPLAYED_CHARS = 1_000_000;

const STATUS_COLORS = ['var(--otto-method-other)', 'var(--otto-method-get)', 'var(--otto-method-post)', 'var(--otto-method-put)', 'var(--otto-method-delete)'];

interface PrettyBody {
    code: string;
    language: HighlightLanguage | null;
}

function prettyBody(response: HttpResponse): PrettyBody {
    const looksJson = /\bjson\b|\+json/i.test(response.contentType ?? '') || /^\s*[[{]/.test(response.body);

    if (looksJson && response.body.length <= MAX_DISPLAYED_CHARS) {
        try {
            const code = JSON.stringify(JSON.parse(response.body), null, 2);

            return { code, language: highlightLanguageFor(code, 'json') };
        } catch {
            // Não é JSON válido: mostra como veio.
        }
    }

    const looksXml = /\b(xml|html)\b|\+xml/i.test(response.contentType ?? '');

    const code = response.body.slice(0, MAX_DISPLAYED_CHARS);

    return { code, language: highlightLanguageFor(code, looksXml ? 'xml' : 'plaintext') };
}

/** Painel de resposta: estado de envio, erro (com sugestões) ou status/tempo/tamanho + corpo, headers, tempos e console. */
@Component({
    selector: 'app-response-panel',
    imports: [ButtonModule, MessageModule, ProgressSpinnerModule, ResponseConsole, TabsModule, CodeEditor],
    template: `
        @switch (entry().status) {
            @case ('sending') {
                <div class="flex h-full flex-col items-center justify-center gap-4" role="status">
                    <p-progress-spinner strokeWidth="4" [style]="{ width: '2.5rem', height: '2.5rem' }" ariaLabel="Sending request" />
                    <p class="m-0 text-sm text-muted-color">Sending request…</p>
                </div>
            }
            @case ('done') {
                <div class="flex h-full min-h-0 flex-col">
                    <!-- Cada item é uma "tag" com a mesma caixa (altura, borda, raio, espaçamento); só a de status troca o fundo pela cor da faixa. -->
                    <div class="flex shrink-0 items-center gap-2 border-b border-surface-200 px-3 py-2 dark:border-surface-700">
                        <dl class="m-0 flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs" aria-label="Response summary">
                            <div class="flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1 font-semibold text-surface-0 dark:text-surface-950" [style.background-color]="statusColor()">
                                <dt class="sr-only">Status</dt>
                                <dd class="m-0">
                                    @if (response(); as res) {
                                        {{ res.status }} {{ res.statusText }}
                                    } @else {
                                        Error
                                    }
                                </dd>
                            </div>
                            <div class="flex items-center gap-1.5 rounded-md border border-surface-200 bg-surface-50 px-2 py-1 dark:border-surface-700 dark:bg-surface-900">
                                <dt class="text-muted-color">Time</dt>
                                <dd class="m-0 font-medium tabular-nums">{{ duration(timeMs()) }}</dd>
                            </div>
                            <div class="flex items-center gap-1.5 rounded-md border border-surface-200 bg-surface-50 px-2 py-1 dark:border-surface-700 dark:bg-surface-900">
                                <dt class="text-muted-color">Size</dt>
                                <dd class="m-0 font-medium tabular-nums">{{ bytes(response()?.size ?? 0) }}</dd>
                            </div>
                            @if (response()?.redirected) {
                                <div class="flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-surface-200 bg-surface-50 px-2 py-1 dark:border-surface-700 dark:bg-surface-900">
                                    <dt class="shrink-0 text-muted-color">Redirected to</dt>
                                    <dd class="m-0 truncate font-mono font-medium" [title]="response()!.url">{{ response()!.url }}</dd>
                                </div>
                            }
                        </dl>
                        @if (response(); as res) {
                            <p-button
                                class="shrink-0"
                                label="Save as example"
                                icon="pi pi-bookmark"
                                size="small"
                                severity="secondary"
                                [text]="true"
                                ariaLabel="Save this response as a mock server example"
                                [disabled]="res.bodyEncoding !== 'utf8' || res.truncated"
                                (onClick)="saveExample.emit({ status: res.status, headers: res.headers, body: res.body, name: (res.status + ' ' + res.statusText).trim() })"
                            />
                        }
                    </div>

                    @if (response()?.truncated) {
                        <p-message severity="warn" styleClass="mx-3 mt-2" size="small">The response is larger than {{ bytes(response()!.size) }} and was cut off.</p-message>
                    }

                    <!-- A tablist não pode encolher (ela tem overflow: hidden e sumiria em janelas baixas); quem rola é só o painel. -->
                    <p-tabs [(value)]="tab" class="min-h-0 flex-1 px-3" scrollable>
                        <p-tablist class="shrink-0">
                            @if (response(); as res) {
                                <p-tab value="body">Body</p-tab>
                                <p-tab value="headers"
                                    >Headers <span class="text-xs text-muted-color">({{ res.headers.length }})</span></p-tab
                                >
                                <p-tab value="timings">Timings</p-tab>
                            } @else {
                                <p-tab value="body">Preview</p-tab>
                            }
                            <p-tab value="console"
                                >Console <span class="text-xs text-muted-color">({{ timeline().length }})</span></p-tab
                            >
                        </p-tablist>
                        <p-tabpanels class="flex min-h-0 flex-1 flex-col overflow-auto">
                            @if (response(); as res) {
                                <p-tabpanel value="body" class="min-h-0 flex-1 flex-col data-[p-active=true]:flex">
                                    @if (res.bodyEncoding === 'base64') {
                                        @if (imageSrc(); as src) {
                                            <img [src]="src" alt="Image returned by the request" class="max-h-96 max-w-full rounded-md border border-surface-200 dark:border-surface-700" />
                                        } @else {
                                            <p class="m-0 text-sm text-muted-color">Binary content ({{ res.contentType }}, {{ bytes(res.size) }}).</p>
                                        }
                                    } @else if (res.size === 0) {
                                        <p class="m-0 text-sm text-muted-color">The response has no body.</p>
                                    } @else {
                                        @if (partial()) {
                                            <p class="m-0 mb-2 text-xs text-muted-color">Showing the first 1,000,000 characters.</p>
                                        }

                                        <app-code-editor class="flex-1" inputId="body-content" [value]="body().code" [language]="body().language" readonly />

                                        <!--                                        <pre-->
                                        <!--                                            class="m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all otto-code-view rounded-md bg-surface-100 p-3 font-mono dark:bg-surface-900"-->
                                        <!--                                            tabindex="0"-->
                                        <!--                                            aria-label="Response body"-->
                                        <!--                                        >@switch (body().language) {-->
                                        <!--                                            @case ('json') {<code [highlight]="body().code" language="json" ignoreIllegals lineNumbers codeFold="json"></code>}-->
                                        <!--                                            @case ('xml') {<code [highlight]="body().code" language="xml" ignoreIllegals lineNumbers codeFold="xml"></code>}-->
                                        <!--                                            @case ('plaintext') {<code [highlight]="body().code" language="plaintext" lineNumbers></code>}-->
                                        <!--                                            @default {<code>{{ body().code }}</code>}-->
                                        <!--                                        }</pre>-->
                                    }
                                </p-tabpanel>
                                <p-tabpanel value="headers">
                                    <table class="w-full table-fixed border-collapse text-sm">
                                        <caption class="sr-only">
                                            Response headers
                                        </caption>
                                        <thead>
                                            <tr class="text-left text-xs text-muted-color">
                                                <th scope="col" class="w-1/3 border-b border-surface-200 py-1.5 pr-4 font-medium dark:border-surface-700">Name</th>
                                                <th scope="col" class="border-b border-surface-200 py-1.5 font-medium dark:border-surface-700">Value</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            @for (header of res.headers; track $index) {
                                                <tr>
                                                    <td class="break-all border-b border-surface-100 py-1.5 pr-4 align-top font-mono dark:border-surface-800">{{ header[0] }}</td>
                                                    <td class="break-all border-b border-surface-100 py-1.5 font-mono dark:border-surface-800">{{ header[1] }}</td>
                                                </tr>
                                            }
                                        </tbody>
                                    </table>
                                </p-tabpanel>
                                <p-tabpanel value="timings">
                                    <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                                        <dt class="text-muted-color">Waiting (TTFB)</dt>
                                        <dd class="m-0">{{ duration(res.timings.ttfbMs) }}</dd>
                                        <dt class="text-muted-color">Download</dt>
                                        <dd class="m-0">{{ duration(res.timings.downloadMs) }}</dd>
                                        <dt class="font-medium">Total</dt>
                                        <dd class="m-0 font-medium">{{ duration(res.timings.totalMs) }}</dd>
                                        <dt class="text-muted-color">Body size</dt>
                                        <dd class="m-0">{{ bytes(res.size) }}</dd>
                                        <dt class="text-muted-color">Headers size</dt>
                                        <dd class="m-0">{{ bytes(res.headersSize) }}</dd>
                                    </dl>
                                </p-tabpanel>
                            } @else if (failure(); as failure) {
                                <p-tabpanel value="body">
                                    <div class="flex flex-col gap-6">
                                        <div role="alert" class="rounded-md border border-surface-200 bg-surface-100 p-3 dark:border-surface-700 dark:bg-surface-900">
                                            <p class="m-0 mb-1 text-sm font-semibold" [style.color]="statusColor()">{{ help().title }}</p>
                                            <p class="m-0 whitespace-pre-wrap break-words font-mono text-sm">Error: {{ failure.error }}</p>
                                        </div>
                                        <section aria-labelledby="response-error-help" class="flex flex-col items-center gap-3 border-t border-surface-200 pt-6 text-center dark:border-surface-700">
                                            <h2 id="response-error-help" class="m-0 text-sm font-medium">Here are some things that may help</h2>
                                            <ul class="m-0 flex max-w-xl list-none flex-col gap-2 p-0 text-sm text-muted-color">
                                                @for (hint of help().hints; track hint) {
                                                    <li>{{ hint }}</li>
                                                }
                                            </ul>
                                            @if (timeline().length) {
                                                <p-button label="Open console" icon="pi pi-list" severity="secondary" [outlined]="true" size="small" (onClick)="tab.set('console')" />
                                            }
                                        </section>
                                    </div>
                                </p-tabpanel>
                            }
                            <p-tabpanel value="console">
                                <app-response-console [timeline]="timeline()" />
                            </p-tabpanel>
                        </p-tabpanels>
                    </p-tabs>
                </div>
            }
        }
    `,
    host: { class: 'block h-full min-h-0' }
})
export class ResponsePanel {
    readonly entry = input.required<ResponseEntry>();
    /** Pedido para guardar a resposta como exemplo do mock server. */
    readonly saveExample = output<{ status: number; headers: Array<[string, string]>; body: string; name: string }>();
    protected readonly timeMs = computed(() => this.response()?.timeMs ?? this.failure()?.timeMs ?? 0);
    protected readonly help = computed(() => errorHelp(this.failure()?.code));
    protected readonly bytes = formatBytes;
    protected readonly duration = formatDuration;
    private readonly result = computed(() => {
        const entry = this.entry();

        return entry.status === 'done' ? entry.result : null;
    });
    protected readonly failure = computed(() => {
        const result = this.result();

        return result && !result.ok ? result : null;
    });
    protected readonly response = computed(() => {
        const result = this.result();

        return result?.ok ? result.response : null;
    });
    protected readonly body = computed<PrettyBody>(() => {
        const response = this.response();

        return response?.bodyEncoding === 'utf8' ? prettyBody(response) : { code: '', language: null };
    });
    protected readonly partial = computed(() => (this.response()?.body.length ?? 0) > MAX_DISPLAYED_CHARS);
    protected readonly imageSrc = computed(() => {
        const response = this.response();
        const mime = response?.contentType?.split(';')[0]?.trim().toLowerCase();

        // Em <img> o SVG não executa scripts, então todas as imagens podem ser exibidas.
        return response?.bodyEncoding === 'base64' && !response.truncated && mime?.startsWith('image/') ? `data:${mime};base64,${response.body}` : null;
    });
    /** Falha usa a cor de erro (5xx). */
    protected readonly statusColor = computed(() => {
        const status = this.response()?.status ?? 500;

        return STATUS_COLORS[Math.min(Math.floor(status / 100) - 1, 4)] ?? STATUS_COLORS[0];
    });
    protected readonly timeline = computed(() => this.result()?.timeline ?? []);
    /** Mantém a aba escolhida entre envios; volta para a primeira se ela não existir no novo resultado. */
    protected readonly tab = linkedSignal<boolean | null, string | number | undefined>({
        // `null` enquanto envia: não mexe na aba.
        source: () => this.result()?.ok ?? null,
        computation: (ok, previous) => (previous && (ok !== false || previous.value === 'console') ? previous.value : 'body')
    });
}
