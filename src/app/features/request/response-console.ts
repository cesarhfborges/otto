import { Component, computed, inject, input } from '@angular/core';
import type { HttpTimelineEntry } from '@shared/models';
import { MessageService } from 'primeng/api';
import { TooltipModule } from 'primeng/tooltip';

const PREFIXES: Record<HttpTimelineEntry['kind'], string> = {
    info: '*',
    error: '*',
    'request-header': '>',
    'request-body': '|',
    'response-header': '<'
};

const COLORS: Partial<Record<HttpTimelineEntry['kind'], string>> = {
    error: 'var(--otto-method-delete)',
    'request-header': 'var(--otto-method-post)',
    'response-header': 'var(--otto-method-get)'
};

interface ConsoleLine {
    prefix: string;
    text: string;
    color: string | null;
    /** Começa um novo bloco (linha em branco antes), como no `curl -v`. */
    gap: boolean;
}

/** `info` e `error` formam o mesmo bloco; os demais tipos abrem um bloco ao mudar. */
const groupOf = (kind: HttpTimelineEntry['kind']): string => (kind === 'error' ? 'info' : kind);

/** Aba Console: cada etapa da execução no formato do `curl -v` (`*` info, `>` enviado, `|` corpo, `<` recebido). */
@Component({
    selector: 'app-response-console',
    imports: [TooltipModule],
    template: `
        @if (lines().length) {
            <div class="relative">
                <button type="button" class="otto-icon-button absolute right-2 top-2 !h-7 !w-7" aria-label="Copy console output" pTooltip="Copy" tooltipPosition="left" (click)="copy()">
                    <i class="pi pi-copy text-xs" aria-hidden="true"></i>
                </button>
                <pre
                    class="m-0 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-100 p-3 pr-10 font-mono text-xs leading-5 dark:bg-surface-900"
                    tabindex="0"
                    aria-label="Request console"
                ><code>@for (line of lines(); track $index) {<span class="block" [class.mt-5]="line.gap" [style.color]="line.color">{{ line.prefix }} {{ line.text }}</span>}</code></pre>
            </div>
        } @else {
            <p class="m-0 text-sm text-muted-color">The request was not sent, so there is no network activity to show.</p>
        }
    `,
    host: { class: 'block' }
})
export class ResponseConsole {
    readonly timeline = input.required<HttpTimelineEntry[]>();

    private readonly messages = inject(MessageService);

    protected readonly lines = computed<ConsoleLine[]>(() =>
        this.timeline().map((entry, index, all) => ({
            prefix: PREFIXES[entry.kind],
            text: entry.text,
            color: COLORS[entry.kind] ?? null,
            gap: index > 0 && groupOf(all[index - 1]!.kind) !== groupOf(entry.kind)
        }))
    );

    protected async copy(): Promise<void> {
        const text = this.lines()
            .map((line) => `${line.gap ? '\n' : ''}${line.prefix} ${line.text}`)
            .join('\n');

        try {
            await navigator.clipboard.writeText(text);
            this.messages.add({ severity: 'info', summary: 'Copied to the clipboard', life: 2000 });
        } catch {
            // Sem acesso à área de transferência.
        }
    }
}
