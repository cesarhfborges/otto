import { Component, computed, input } from '@angular/core';
import type { HttpResponse } from '@shared/models';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TabsModule } from 'primeng/tabs';
import type { ResponseEntry } from '../../core/state/responses.state';
import { formatBytes, formatDuration } from '../../shared/format';
import { highlightCode } from '../../shared/highlight';

/** Acima disso o corpo é exibido parcialmente (o visualizador completo chega na Etapa 7). */
const MAX_DISPLAYED_CHARS = 1_000_000;

const STATUS_COLORS = ['var(--otto-method-other)', 'var(--otto-method-get)', 'var(--otto-method-post)', 'var(--otto-method-put)', 'var(--otto-method-delete)'];

function prettyBody(response: HttpResponse): string {
    const looksJson = /\bjson\b|\+json/i.test(response.contentType ?? '') || /^\s*[[{]/.test(response.body);

    if (looksJson && response.body.length <= MAX_DISPLAYED_CHARS) {
        try {
            return highlightCode(JSON.stringify(JSON.parse(response.body), null, 2), 'json');
        } catch {
            // Não é JSON válido: mostra como veio.
        }
    }

    const looksXml = /\b(xml|html)\b|\+xml/i.test(response.contentType ?? '');

    return highlightCode(response.body.slice(0, MAX_DISPLAYED_CHARS), looksXml ? 'xml' : null);
}

/** Painel de resposta: estado de envio, erro ou status/tempo/tamanho + corpo, headers e tempos. */
@Component({
    selector: 'app-response-panel',
    imports: [MessageModule, ProgressSpinnerModule, TabsModule],
    template: `
        @switch (entry().status) {
            @case ('sending') {
                <div class="flex h-full flex-col items-center justify-center gap-4" role="status">
                    <p-progress-spinner strokeWidth="4" [style]="{ width: '2.5rem', height: '2.5rem' }" ariaLabel="Sending request" />
                    <p class="m-0 text-sm text-muted-color">Sending request…</p>
                </div>
            }
            @case ('done') {
                @if (failure(); as failure) {
                    <div class="p-4">
                        <p-message severity="error"
                            ><span role="alert">{{ failure }}</span></p-message
                        >
                    </div>
                } @else if (response(); as res) {
                    <div class="flex h-full min-h-0 flex-col">
                        <dl class="m-0 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-surface-200 px-3 py-2 text-sm dark:border-surface-700" aria-label="Response summary">
                            <div class="flex gap-1">
                                <dt class="sr-only">Status</dt>
                                <dd class="m-0 font-semibold" [style.color]="statusColor()">{{ res.status }} {{ res.statusText }}</dd>
                            </div>
                            <div class="flex gap-1">
                                <dt class="text-muted-color">Time</dt>
                                <dd class="m-0">{{ duration(res.timeMs) }}</dd>
                            </div>
                            <div class="flex gap-1">
                                <dt class="text-muted-color">Size</dt>
                                <dd class="m-0">{{ bytes(res.size) }}</dd>
                            </div>
                            @if (res.redirected) {
                                <div class="flex min-w-0 gap-1">
                                    <dt class="text-muted-color">Redirected to</dt>
                                    <dd class="m-0 truncate font-mono text-xs" [title]="res.url">{{ res.url }}</dd>
                                </div>
                            }
                        </dl>

                        @if (res.truncated) {
                            <p-message severity="warn" styleClass="mx-3 mt-2" size="small">The response is larger than {{ bytes(res.size) }} and was cut off.</p-message>
                        }

                        <p-tabs value="body" class="min-h-0 flex-1 px-3" scrollable>
                            <p-tablist>
                                <p-tab value="body">Body</p-tab>
                                <p-tab value="headers"
                                    >Headers <span class="text-xs text-muted-color">({{ res.headers.length }})</span></p-tab
                                >
                                <p-tab value="timings">Timings</p-tab>
                            </p-tablist>
                            <p-tabpanels>
                                <p-tabpanel value="body">
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
                                        <pre class="m-0 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-100 p-3 font-mono text-sm dark:bg-surface-900" tabindex="0" aria-label="Response body"><code [innerHTML]="body()"></code></pre>
                                    }
                                </p-tabpanel>
                                <p-tabpanel value="headers">
                                    <table class="w-full border-collapse text-sm">
                                        <caption class="sr-only">
                                            Response headers
                                        </caption>
                                        <thead>
                                            <tr class="text-left text-xs text-muted-color">
                                                <th scope="col" class="border-b border-surface-200 py-1.5 font-medium dark:border-surface-700">Name</th>
                                                <th scope="col" class="border-b border-surface-200 py-1.5 font-medium dark:border-surface-700">Value</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            @for (header of res.headers; track $index) {
                                                <tr>
                                                    <td class="border-b border-surface-100 py-1.5 pr-4 align-top font-mono dark:border-surface-800">{{ header[0] }}</td>
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
                            </p-tabpanels>
                        </p-tabs>
                    </div>
                }
            }
        }
    `,
    host: { class: 'block h-full min-h-0' }
})
export class ResponsePanel {
    readonly entry = input.required<ResponseEntry>();

    private readonly result = computed(() => {
        const entry = this.entry();

        return entry.status === 'done' ? entry.result : null;
    });

    protected readonly failure = computed(() => {
        const result = this.result();

        return result && !result.ok ? result.error : null;
    });

    protected readonly response = computed(() => {
        const result = this.result();

        return result?.ok ? result.response : null;
    });

    protected readonly body = computed(() => {
        const response = this.response();

        return response?.bodyEncoding === 'utf8' ? prettyBody(response) : '';
    });

    protected readonly partial = computed(() => (this.response()?.body.length ?? 0) > MAX_DISPLAYED_CHARS);

    protected readonly imageSrc = computed(() => {
        const response = this.response();
        const mime = response?.contentType?.split(';')[0]?.trim().toLowerCase();

        // Em <img> o SVG não executa scripts, então todas as imagens podem ser exibidas.
        return response?.bodyEncoding === 'base64' && !response.truncated && mime?.startsWith('image/') ? `data:${mime};base64,${response.body}` : null;
    });

    protected readonly statusColor = computed(() => STATUS_COLORS[Math.min(Math.floor((this.response()?.status ?? 0) / 100) - 1, 4)] ?? STATUS_COLORS[0]);

    protected readonly bytes = formatBytes;
    protected readonly duration = formatDuration;
}
