import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import type { EntityId } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TabsModule } from 'primeng/tabs';
import { ConfirmState } from '../../core/state/confirm.state';
import { type HistoryRun, RequestHistoryState } from '../../core/state/request-history.state';
import { CodeEditor } from '../../shared/code-editor';
import { DiffView } from '../../shared/diff-view';
import { LARGE_DIALOG_CONTENT, LARGE_DIALOG_STYLE } from '../../shared/dialog-size';
import { formatBytes, formatDuration } from '../../shared/format';
import { diffLines, normalizeForDiff } from '../../shared/text-diff';

const headersText = (headers: ReadonlyArray<[string, string]> | undefined): string =>
    (headers ?? [])
        .map(([name, value]) => `${name.toLowerCase()}: ${value}`)
        .sort()
        .join('\n');

/** Execuções desta requisição enquanto a aba está aberta (só em memória): rever, comparar duas e apagar. */
@Component({
    selector: 'app-request-history',
    imports: [ButtonModule, DialogModule, TabsModule, CodeEditor, DiffView],
    template: `
        <div class="mb-2 flex flex-wrap items-center gap-2">
            <p id="history-help" class="m-0 text-xs text-muted-color">Kept in memory only and cleared when this tab or Otto closes. Select two runs to compare them.</p>
            <p-button class="ms-auto" label="Clear history" icon="pi pi-trash" size="small" severity="danger" [text]="true" [disabled]="!entries().length" (onClick)="clearAll()" />
            <p-button label="Compare" icon="pi pi-arrow-right-arrow-left" size="small" [disabled]="selected().length !== 2" (onClick)="compare(selected()[0]!, selected()[1]!)" />
        </div>

        @if (entries().length) {
            <table class="w-full table-fixed border-collapse text-sm" aria-describedby="history-help">
                <caption class="sr-only">
                    Previous runs of this request, most recent first
                </caption>
                <thead>
                    <tr class="text-left text-xs text-muted-color">
                        <th scope="col" class="w-8 border-b border-surface-200 py-1.5 dark:border-surface-700"><span class="sr-only">Select</span></th>
                        <th scope="col" class="border-b border-surface-200 py-1.5 font-medium dark:border-surface-700">When</th>
                        <th scope="col" class="w-20 border-b border-surface-200 py-1.5 font-medium dark:border-surface-700">Status</th>
                        <th scope="col" class="w-20 border-b border-surface-200 py-1.5 font-medium dark:border-surface-700">Time</th>
                        <th scope="col" class="w-20 border-b border-surface-200 py-1.5 font-medium dark:border-surface-700">Size</th>
                        <th scope="col" class="w-32 border-b border-surface-200 py-1.5 dark:border-surface-700"><span class="sr-only">Actions</span></th>
                    </tr>
                </thead>
                <tbody>
                    @for (entry of entries(); track entry.id; let i = $index) {
                        <tr>
                            <td class="border-b border-surface-100 py-1 dark:border-surface-800">
                                <input
                                    type="checkbox"
                                    class="h-4 w-4 accent-[var(--p-primary-color)]"
                                    [checked]="isSelected(entry.id)"
                                    [disabled]="!isSelected(entry.id) && selected().length >= 2"
                                    [attr.aria-label]="'Select run of ' + when(entry.executedAt) + ' to compare'"
                                    (change)="toggle(entry.id)"
                                />
                            </td>
                            <td class="truncate border-b border-surface-100 py-1 dark:border-surface-800" [title]="entry.url">{{ when(entry.executedAt) }}</td>
                            <td class="border-b border-surface-100 py-1 font-medium tabular-nums dark:border-surface-800" [class]="statusClass(entry.status)">{{ entry.status ?? 'Error' }}</td>
                            <td class="border-b border-surface-100 py-1 tabular-nums dark:border-surface-800">{{ duration(entry.timeMs) }}</td>
                            <td class="border-b border-surface-100 py-1 tabular-nums dark:border-surface-800">{{ bytes(entry.sizeBytes) }}</td>
                            <td class="border-b border-surface-100 py-1 text-right dark:border-surface-800">
                                <button type="button" class="otto-icon-button !h-7 !w-7" [attr.aria-label]="'View run of ' + when(entry.executedAt)" (click)="view(entry.id)">
                                    <i class="pi pi-eye text-xs" aria-hidden="true"></i>
                                </button>
                                @if (entries()[i + 1]; as previous) {
                                    <button type="button" class="otto-icon-button !h-7 !w-7" [attr.aria-label]="'Compare run of ' + when(entry.executedAt) + ' with the previous one'" (click)="compare(previous.id, entry.id)">
                                        <i class="pi pi-arrow-right-arrow-left text-xs" aria-hidden="true"></i>
                                    </button>
                                }
                                <button type="button" class="otto-icon-button !h-7 !w-7" [attr.aria-label]="'Delete run of ' + when(entry.executedAt)" (click)="remove(entry)">
                                    <i class="pi pi-trash text-xs" aria-hidden="true"></i>
                                </button>
                            </td>
                        </tr>
                    }
                </tbody>
            </table>
        } @else {
            <p class="m-0 text-sm text-muted-color">No runs yet. Send the request to see its runs here while this tab stays open.</p>
        }

        <p-dialog
            closeAriaLabel="Close"
            [header]="viewed() ? 'Run of ' + when(viewed()!.executedAt) : 'Run'"
            [modal]="true"
            [visible]="!!viewed()"
            (visibleChange)="!$event && viewed.set(null)"
            [style]="dialogStyle"
            [contentStyleClass]="dialogContent"
            [resizable]="false"
            [maximizable]="false"
            [draggable]="false"
            appendTo="body"
        >
            @if (viewed(); as run) {
                <p-tabs value="response" class="flex min-h-0 flex-1 flex-col">
                        <p-tablist class="shrink-0">
                            <p-tab value="response">Response</p-tab>
                            <p-tab value="request">Request</p-tab>
                        </p-tablist>
                        <p-tabpanels class="flex min-h-0 flex-1 flex-col !px-0">
                            <p-tabpanel value="response" class="min-h-0 flex-1 flex-col gap-2 data-[p-active=true]:flex">
                                @if (run.response; as response) {
                                    <p class="m-0 shrink-0 text-sm font-medium">{{ response.status }} {{ response.statusText }} · {{ duration(run.timeMs) }} · {{ bytes(run.sizeBytes) }}</p>
                                    <div class="grid min-h-0 flex-1 grid-rows-[minmax(5rem,2fr)_minmax(7rem,3fr)] gap-2">
                                        <app-code-editor class="!min-h-0" inputId="history-response-headers" [value]="headers(response.headers)" readonly />
                                        <app-code-editor class="!min-h-0" inputId="history-response-body" [value]="body(response.body)" language="json" readonly />
                                    </div>
                                } @else {
                                    <p class="m-0 text-sm">Error: {{ run.error }}</p>
                                }
                            </p-tabpanel>
                            <p-tabpanel value="request" class="min-h-0 flex-1 flex-col gap-2 data-[p-active=true]:flex">
                                <p class="m-0 line-clamp-2 shrink-0 break-all font-mono text-sm" [title]="run.request.url">{{ run.request.method }} {{ run.request.url }}</p>
                                <div class="grid min-h-0 flex-1 grid-rows-[minmax(5rem,2fr)_minmax(7rem,3fr)] gap-2">
                                    <app-code-editor class="!min-h-0" inputId="history-request-headers" [value]="headers(run.request.headers)" readonly />
                                    <app-code-editor class="!min-h-0" inputId="history-request-body" [value]="body(run.request.body)" language="json" readonly />
                                </div>
                            </p-tabpanel>
                        </p-tabpanels>
                    </p-tabs>
            }
            <ng-template #footer>
                @if (viewed()?.response) {
                    <p-button label="Save response as example" icon="pi pi-bookmark" severity="secondary" [text]="true" (onClick)="saveViewedAsExample()" />
                }
                <p-button label="Close" (onClick)="viewed.set(null)" />
            </ng-template>
        </p-dialog>

        <p-dialog
            closeAriaLabel="Close"
            header="Compare Runs"
            [modal]="true"
            [visible]="!!comparison()"
            (visibleChange)="!$event && comparison.set(null)"
            [style]="dialogStyle"
            [contentStyleClass]="dialogContent"
            [resizable]="false"
            [maximizable]="false"
            [draggable]="false"
            appendTo="body"
        >
            @if (comparison(); as pair) {
                <dl class="m-0 mb-3 grid shrink-0 grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-1 text-sm">
                    <dt class="sr-only">Run</dt>
                    <dd class="col-start-2 m-0 font-semibold">Before · {{ when(pair.before.executedAt) }}</dd>
                    <dd class="m-0 font-semibold">After · {{ when(pair.after.executedAt) }}</dd>
                    <dt class="text-muted-color">Status</dt>
                    <dd class="m-0">{{ pair.before.status ?? 'Error' }}</dd>
                    <dd class="m-0" [class.font-semibold]="pair.before.status !== pair.after.status">{{ pair.after.status ?? 'Error' }}</dd>
                    <dt class="text-muted-color">Time</dt>
                    <dd class="m-0">{{ duration(pair.before.timeMs) }}</dd>
                    <dd class="m-0">{{ duration(pair.after.timeMs) }} ({{ delta(pair.after.timeMs - pair.before.timeMs) }})</dd>
                    <dt class="text-muted-color">Size</dt>
                    <dd class="m-0">{{ bytes(pair.before.sizeBytes) }}</dd>
                    <dd class="m-0">{{ bytes(pair.after.sizeBytes) }}</dd>
                </dl>
                <p-tabs value="body" class="flex min-h-0 flex-1 flex-col">
                    <p-tablist class="shrink-0">
                        <p-tab value="body">Response body</p-tab>
                        <p-tab value="headers">Response headers</p-tab>
                        <p-tab value="request">Request</p-tab>
                    </p-tablist>
                    <p-tabpanels class="flex min-h-0 flex-1 flex-col !px-0">
                        <p-tabpanel value="body" class="min-h-0 flex-1 flex-col data-[p-active=true]:flex">
                            <p class="m-0 mb-2 shrink-0 text-xs text-muted-color">JSON is compared with keys sorted, so reordering alone is not reported.</p>
                            <app-diff-view class="flex-1" label="Response body differences" [lines]="diff().body" />
                        </p-tabpanel>
                        <p-tabpanel value="headers" class="min-h-0 flex-1 flex-col data-[p-active=true]:flex">
                            <app-diff-view class="flex-1" label="Response header differences" [lines]="diff().headers" />
                        </p-tabpanel>
                        <p-tabpanel value="request" class="min-h-0 flex-1 flex-col data-[p-active=true]:flex">
                            <app-diff-view class="flex-1" label="Request differences" [lines]="diff().request" />
                        </p-tabpanel>
                    </p-tabpanels>
                </p-tabs>
            }
            <ng-template #footer>
                <p-button label="Close" (onClick)="comparison.set(null)" />
            </ng-template>
        </p-dialog>
    `,
    host: { class: 'block' }
})
export class RequestHistory {
    readonly collectionId = input.required<EntityId>();
    readonly path = input.required<string>();
    /** Resposta de uma execução anterior escolhida para virar exemplo do mock. */
    readonly saveExample = output<{ status: number; headers: Array<[string, string]>; body: string; name: string }>();

    private readonly history = inject(RequestHistoryState);
    private readonly confirm = inject(ConfirmState);

    protected readonly entries = computed(() => this.history.list(this.collectionId(), this.path()));
    protected readonly selected = signal<string[]>([]);
    protected readonly viewed = signal<HistoryRun | null>(null);
    protected readonly comparison = signal<{ before: HistoryRun; after: HistoryRun } | null>(null);
    protected readonly dialogStyle = LARGE_DIALOG_STYLE;
    protected readonly dialogContent = LARGE_DIALOG_CONTENT;
    protected readonly bytes = formatBytes;
    protected readonly duration = formatDuration;

    protected readonly diff = computed(() => {
        const pair = this.comparison();
        const before = pair?.before;
        const after = pair?.after;
        const requestText = (run: HistoryRun | undefined): string => (run ? `${run.request.method} ${run.request.url}\n\n${headersText(run.request.headers)}\n\n${normalizeForDiff(run.request.body)}` : '');

        return {
            body: diffLines(normalizeForDiff(before?.response?.body ?? null), normalizeForDiff(after?.response?.body ?? null)),
            headers: diffLines(headersText(before?.response?.headers), headersText(after?.response?.headers)),
            request: diffLines(requestText(before), requestText(after))
        };
    });

    constructor() {
        effect(() => {
            this.collectionId();
            this.path();
            untracked(() => this.selected.set([]));
        });
    }

    protected when(timestamp: number): string {
        return new Date(timestamp).toLocaleString();
    }

    protected delta(ms: number): string {
        return `${ms >= 0 ? '+' : '−'}${formatDuration(Math.abs(ms))}`;
    }

    protected statusClass(status: number | null): string {
        return status === null || status >= 400 ? 'text-red-700 dark:text-red-400' : status >= 300 ? 'text-amber-800 dark:text-amber-300' : 'text-green-800 dark:text-green-400';
    }

    protected headers(headers: ReadonlyArray<[string, string]>): string {
        return headers.map(([name, value]) => `${name}: ${value}`).join('\n');
    }

    protected body(text: string | null): string {
        return text === null ? '(not kept: binary or too large)' : normalizeForDiff(text);
    }

    protected isSelected(id: string): boolean {
        return this.selected().includes(id);
    }

    protected toggle(id: string): void {
        this.selected.update((ids) => (ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id].slice(-2)));
    }

    protected view(id: string): void {
        this.viewed.set(this.find(id));
    }

    /** Compara na ordem cronológica (mais antiga como "antes"). */
    protected compare(first: string, second: string): void {
        const a = this.find(first);
        const b = this.find(second);

        if (a && b) {
            const [before, after] = a.executedAt <= b.executedAt ? [a, b] : [b, a];

            this.comparison.set({ before, after });
        }
    }

    protected async remove(entry: HistoryRun): Promise<void> {
        if (await this.confirm.askDelete({ header: 'Delete Run', message: `Delete the run of ${this.when(entry.executedAt)} from the history?`, acceptLabel: 'Delete' })) {
            this.history.remove(this.collectionId(), this.path(), entry.id);
            this.selected.update((ids) => ids.filter((id) => id !== entry.id));
        }
    }

    protected async clearAll(): Promise<void> {
        if (await this.confirm.askDelete({ header: 'Clear History', message: 'Delete every run of this request from the history?', acceptLabel: 'Clear' })) {
            this.history.clear(this.collectionId(), this.path());
            this.selected.set([]);
        }
    }

    protected saveViewedAsExample(): void {
        const response = this.viewed()?.response;

        if (response) {
            this.saveExample.emit({ status: response.status, headers: response.headers, body: response.body ?? '', name: `${response.status} ${response.statusText}`.trim() });
            this.viewed.set(null);
        }
    }

    private find(id: string): HistoryRun | null {
        return this.entries().find((run) => run.id === id) ?? null;
    }
}
