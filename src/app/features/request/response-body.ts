import { Component, computed, DestroyRef, effect, inject, input, linkedSignal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, type SafeHtml, type SafeResourceUrl } from '@angular/platform-browser';
import type { HttpResponse } from '@shared/models';
import { jsonPathAll } from '@shared/templating';
import { search as jmesSearch } from 'jmespath';
import { InputTextModule } from 'primeng/inputtext';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { CodeEditor } from '../../shared/code-editor';
import { formatBytes } from '../../shared/format';
import { type HighlightLanguage, highlightLanguageFor } from '../../shared/highlight';

/** Acima disso o corpo é exibido parcialmente. */
const MAX_DISPLAYED_CHARS = 1_000_000;

type ViewMode = 'pretty' | 'raw' | 'preview';
type FilterLanguage = 'jsonpath' | 'jmespath';
type PreviewKind = 'html' | 'image' | 'pdf' | null;

/**
 * Página HTML sem scripts (o iframe não tem `allow-scripts`) e, por padrão, sem acesso à rede:
 * só imagens/estilos/fontes embutidos. Com `external`, carrega recursos de qualquer origem (`<base>` = URL da resposta).
 */
function sandboxedHtml(html: string, baseUrl: string, external: boolean): string {
    const policy = external ? "default-src 'none'; img-src * data: blob:; style-src * 'unsafe-inline'; font-src * data:; media-src *" : "default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:";
    const base = external ? `<base href="${baseUrl.replace(/"/g, '&quot;')}">` : '';

    return `<meta http-equiv="Content-Security-Policy" content="${policy}">${base}${html}`;
}

const mimeOf = (response: HttpResponse): string => response.contentType?.split(';')[0]?.trim().toLowerCase() ?? '';

function previewKind(response: HttpResponse): PreviewKind {
    const mime = mimeOf(response);

    if (response.truncated) {
        return mime === 'text/html' || mime === 'application/xhtml+xml' ? 'html' : null;
    }

    if (mime.startsWith('image/')) {
        return 'image';
    }

    if (mime === 'application/pdf' && response.bodyEncoding === 'base64') {
        return 'pdf';
    }

    return response.bodyEncoding === 'utf8' && (mime === 'text/html' || mime === 'application/xhtml+xml' || (!mime && /^\s*<(!doctype html|html)\b/i.test(response.body))) ? 'html' : null;
}

function parseJson(response: HttpResponse): { ok: true; value: unknown } | { ok: false } {
    const looksJson = /\bjson\b|\+json/i.test(response.contentType ?? '') || /^\s*[[{]/.test(response.body);

    if (response.bodyEncoding !== 'utf8' || !looksJson || response.body.length > MAX_DISPLAYED_CHARS) {
        return { ok: false };
    }

    try {
        return { ok: true, value: JSON.parse(response.body) };
    } catch {
        return { ok: false };
    }
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

/**
 * Corpo da resposta: formatado (com filtro JSONPath/JMESPath para JSON), bruto ou
 * pré-visualizado (HTML num iframe isolado, imagens e PDF).
 */
@Component({
    selector: 'app-response-body',
    imports: [FormsModule, CodeEditor, InputTextModule, SelectButtonModule, ToggleSwitchModule],
    template: `
        @let res = response();
        <div class="mb-2 flex flex-wrap items-center gap-2">
            @if (modes().length > 1) {
                <p-select-button [options]="modes()" [ngModel]="mode()" (ngModelChange)="mode.set($event)" optionLabel="label" optionValue="value" [allowEmpty]="false" size="small" ariaLabelledBy="response-view-label" />
                <span id="response-view-label" class="sr-only">Response view</span>
            }
            @if (mode() === 'pretty' && json().ok) {
                <div class="flex min-w-56 flex-1 items-center gap-2">
                    <p-select-button [options]="filterLanguages" [ngModel]="filterLanguage()" (ngModelChange)="filterLanguage.set($event)" optionLabel="label" optionValue="value" [allowEmpty]="false" size="small" ariaLabelledBy="response-filter-language-label" />
                    <span id="response-filter-language-label" class="sr-only">Filter language</span>
                    <label for="response-filter" class="sr-only">Filter the JSON response</label>
                    <input
                        pInputText
                        id="response-filter"
                        class="min-w-0 flex-1 font-mono !text-sm"
                        pSize="small"
                        [placeholder]="filterLanguage() === 'jsonpath' ? '$.data[*].id' : 'data[*].id'"
                        autocomplete="off"
                        spellcheck="false"
                        [ngModel]="filter()"
                        (ngModelChange)="filter.set($event)"
                        [attr.aria-invalid]="filterInvalid()"
                        aria-describedby="response-filter-status"
                    />
                </div>
            }
            @if (mode() === 'preview' && kind() === 'html') {
                <div class="ms-auto flex items-center gap-2">
                    <p-toggleswitch inputId="response-external" [(ngModel)]="external" ariaLabelledBy="response-external-label" />
                    <label id="response-external-label" for="response-external" class="text-xs">Load external images and styles</label>
                </div>
            }
        </div>
        <p id="response-filter-status" class="m-0 text-xs empty:hidden" [class]="filterInvalid() ? 'text-red-700 dark:text-red-400' : 'text-muted-color'" aria-live="polite">{{ filterStatus() }}</p>

        @switch (mode()) {
            @case ('preview') {
                @switch (kind()) {
                    @case ('html') {
                        <iframe class="min-h-80 w-full flex-1 rounded-md border border-surface-200 bg-white dark:border-surface-700" sandbox="" title="Preview of the HTML response (scripts disabled)" [srcdoc]="htmlDoc()"></iframe>
                        <p class="m-0 mt-1 text-xs text-muted-color">Scripts never run in the preview.{{ external() ? '' : ' External resources are blocked.' }}</p>
                    }
                    @case ('image') {
                        @if (imageSrc(); as src) {
                            <div class="flex min-h-0 flex-1 items-start justify-center overflow-auto rounded-md border border-surface-200 bg-[repeating-conic-gradient(var(--p-surface-100)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-3 dark:border-surface-700 dark:bg-[repeating-conic-gradient(var(--p-surface-800)_0%_25%,transparent_0%_50%)]">
                                <img [src]="src" [alt]="'Image returned by the request (' + mime() + ')'" class="max-w-full" />
                            </div>
                        }
                    }
                    @case ('pdf') {
                        @if (pdfUrl(); as url) {
                            <iframe class="min-h-96 w-full flex-1 rounded-md border border-surface-200 dark:border-surface-700" title="Preview of the PDF response" [src]="url"></iframe>
                        }
                    }
                }
            }
            @default {
                @if (res.bodyEncoding === 'base64') {
                    <p class="m-0 text-sm text-muted-color">Binary content ({{ res.contentType || 'unknown type' }}, {{ bytes(res.size) }}).</p>
                } @else if (res.size === 0) {
                    <p class="m-0 text-sm text-muted-color">The response has no body.</p>
                } @else {
                    @if (partial()) {
                        <p class="m-0 mb-2 text-xs text-muted-color">Showing the first 1,000,000 characters.</p>
                    }
                    <app-code-editor class="flex-1" inputId="body-content" [ariaLabel]="filtered() ? 'Filtered response body' : 'Response body'" [value]="shown().code" [language]="shown().language" readonly />
                }
            }
        }
    `,
    host: { class: 'flex min-h-0 flex-1 flex-col' }
})
export class ResponseBody {
    readonly response = input.required<HttpResponse>();

    private readonly sanitizer = inject(DomSanitizer);

    protected readonly bytes = formatBytes;
    protected readonly filterLanguages: Array<{ label: string; value: FilterLanguage }> = [
        { label: 'JSONPath', value: 'jsonpath' },
        { label: 'JMESPath', value: 'jmespath' }
    ];
    protected readonly mime = computed(() => mimeOf(this.response()));
    protected readonly kind = computed(() => previewKind(this.response()));
    protected readonly json = computed(() => parseJson(this.response()));
    protected readonly modes = computed(() => {
        const text = this.response().bodyEncoding === 'utf8';

        return [...(text ? [{ label: 'Pretty', value: 'pretty' as const }, { label: 'Raw', value: 'raw' as const }] : []), ...(this.kind() ? [{ label: 'Preview', value: 'preview' as const }] : [])];
    });
    /** Mantém o modo escolhido entre respostas quando ele existe; binários com prévia abrem nela. */
    protected readonly mode = linkedSignal<Array<{ value: ViewMode }>, ViewMode>({
        source: () => this.modes(),
        computation: (modes, previous) => (previous && modes.some((m) => m.value === previous.value) ? previous.value : (modes[0]?.value ?? 'raw'))
    });
    protected readonly filterLanguage = signal<FilterLanguage>('jsonpath');
    protected readonly filter = signal('');
    protected readonly external = signal(false);

    protected readonly filtered = computed<{ value: unknown; error: string | null; count: number | null } | null>(() => {
        const json = this.json();
        const expression = this.filter().trim();

        if (!json.ok || !expression) {
            return null;
        }

        try {
            if (this.filterLanguage() === 'jsonpath') {
                const matches = jsonPathAll(json.value, expression);

                return { value: matches.length === 1 ? matches[0] : matches, error: null, count: matches.length };
            }

            return { value: jmesSearch(json.value as Parameters<typeof jmesSearch>[0], expression), error: null, count: null };
        } catch (error) {
            return { value: undefined, error: error instanceof Error ? error.message : String(error), count: null };
        }
    });
    protected readonly filterInvalid = computed(() => !!this.filtered()?.error);
    protected readonly filterStatus = computed(() => {
        const filtered = this.filtered();

        if (!filtered || this.mode() !== 'pretty') {
            return '';
        }

        if (filtered.error) {
            return `Invalid expression: ${filtered.error}`;
        }

        return filtered.count === null ? 'Filtered with JMESPath.' : filtered.count === 0 ? 'No matches.' : `${filtered.count} match${filtered.count === 1 ? '' : 'es'}.`;
    });

    protected readonly partial = computed(() => this.mode() !== 'preview' && !this.filtered() && this.response().body.length > MAX_DISPLAYED_CHARS);
    protected readonly shown = computed<{ code: string; language: HighlightLanguage | null }>(() => {
        const response = this.response();
        const json = this.json();

        if (this.mode() === 'raw') {
            const code = response.body.slice(0, MAX_DISPLAYED_CHARS);

            return { code, language: highlightLanguageFor(code, 'plaintext') };
        }

        if (json.ok) {
            const filtered = this.filtered();
            const value = filtered && !filtered.error ? filtered.value : json.value;
            const code = value === undefined ? '' : JSON.stringify(value, null, 2);

            return { code, language: highlightLanguageFor(code, 'json') };
        }

        const code = response.body.slice(0, MAX_DISPLAYED_CHARS);
        const looksXml = /\b(xml|html)\b|\+xml/i.test(response.contentType ?? '');

        return { code, language: highlightLanguageFor(code, looksXml ? 'xml' : 'plaintext') };
    });

    protected readonly htmlDoc = computed<SafeHtml>(() => {
        const response = this.response();

        // Seguro: o iframe é `sandbox=""` (sem scripts, formulários, popups nem a mesma origem do app).
        return this.sanitizer.bypassSecurityTrustHtml(sandboxedHtml(response.body, response.url, this.external()));
    });
    protected readonly imageSrc = computed(() => {
        const response = this.response();
        const mime = this.mime();

        // Em <img> o SVG não executa scripts, então todas as imagens podem ser exibidas.
        if (response.bodyEncoding === 'base64') {
            return `data:${mime};base64,${response.body}`;
        }

        return `data:${mime};charset=utf-8,${encodeURIComponent(response.body)}`;
    });
    private readonly pdfObjectUrl = computed(() => {
        const response = this.response();

        return this.kind() === 'pdf' ? URL.createObjectURL(new Blob([base64ToBytes(response.body)], { type: 'application/pdf' })) : null;
    });
    protected readonly pdfUrl = computed<SafeResourceUrl | null>(() => {
        const url = this.pdfObjectUrl();

        // `blob:` criado aqui a partir da própria resposta.
        return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
    });

    constructor() {
        let previous: string | null = null;

        effect(() => {
            const url = this.pdfObjectUrl();

            if (previous && previous !== url) {
                URL.revokeObjectURL(previous);
            }

            previous = url;
        });
        inject(DestroyRef).onDestroy(() => previous && URL.revokeObjectURL(previous));
    }
}
