import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import type { HttpTimelineEntry } from '@shared/models';

/** Linha de requisição (`GET /items HTTP/1.1`) que abre cada salto no console. */
const REQUEST_LINE = /^(\S+) \S+ HTTP\/[\d.]+$/;

/**
 * Headers enviados na requisição que gerou a resposta final: o último salto do console (com
 * redirecionamentos, o pedido ao destino final; o CONNECT de um proxy não conta). Sem console, nenhum.
 */
export function requestHeaders(timeline: readonly HttpTimelineEntry[]): Array<[string, string]> {
    let current: Array<[string, string]> | null = null;
    let last: Array<[string, string]> = [];

    for (const entry of timeline) {
        if (entry.kind !== 'request-header') {
            continue;
        }

        const start = REQUEST_LINE.exec(entry.text);

        if (start) {
            current = start[1] === 'CONNECT' ? null : [];

            if (current) {
                last = current;
            }
        } else if (current) {
            const separator = entry.text.indexOf(':');

            if (separator > 0) {
                current.push([entry.text.slice(0, separator).trim(), entry.text.slice(separator + 1).trim()]);
            }
        }
    }

    return last;
}

/**
 * Aba "Headers" do painel de resposta, em duas partes: o que a requisição enviou (pode ser ocultado nas
 * preferências) e o que o servidor respondeu.
 */
@Component({
    selector: 'app-response-headers',
    template: `
        @if (showSent()) {
            <section aria-labelledby="response-headers-sent" class="mb-6">
                <h2 id="response-headers-sent" class="otto-section-label mb-1 flex items-center gap-1.5">
                    <i class="pi pi-arrow-up-right text-xs" aria-hidden="true"></i>
                    Sent <span class="font-normal">({{ sent().length }})</span>
                </h2>
                @if (sent().length) {
                    <ng-container *ngTemplateOutlet="table; context: { $implicit: sent(), caption: 'Request headers' }" />
                } @else {
                    <p class="m-0 py-2 text-sm text-muted-color">No request headers were recorded.</p>
                }
            </section>
        }

        <section aria-labelledby="response-headers-received">
            <h2 id="response-headers-received" class="otto-section-label mb-1 flex items-center gap-1.5">
                <i class="pi pi-arrow-down-left text-xs" aria-hidden="true"></i>
                Received <span class="font-normal">({{ received().length }})</span>
            </h2>
            <ng-container *ngTemplateOutlet="table; context: { $implicit: received(), caption: 'Response headers' }" />
        </section>

        <ng-template #table let-headers let-caption="caption">
            <table class="w-full table-fixed border-collapse text-sm">
                <caption class="sr-only">
                    {{
                        caption
                    }}
                </caption>
                <thead>
                    <tr class="text-left text-xs text-muted-color">
                        <th scope="col" class="w-1/3 border-b border-surface-200 py-1.5 pr-4 font-medium dark:border-surface-700">Name</th>
                        <th scope="col" class="border-b border-surface-200 py-1.5 font-medium dark:border-surface-700">Value</th>
                    </tr>
                </thead>
                <tbody>
                    @for (header of headers; track $index) {
                        <tr>
                            <td class="break-all border-b border-surface-100 py-1.5 pr-4 align-top font-mono dark:border-surface-800">{{ header[0] }}</td>
                            <td class="break-all border-b border-surface-100 py-1.5 font-mono dark:border-surface-800">{{ header[1] }}</td>
                        </tr>
                    }
                </tbody>
            </table>
        </ng-template>
    `,
    imports: [NgTemplateOutlet]
})
export class ResponseHeaders {
    readonly received = input.required<ReadonlyArray<[string, string]>>();
    readonly timeline = input<readonly HttpTimelineEntry[]>([]);
    /** Preferência "Show request headers". */
    readonly showSent = input(true);

    protected readonly sent = computed(() => requestHeaders(this.timeline()));
}
