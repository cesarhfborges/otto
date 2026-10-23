import { Component, computed, input } from '@angular/core';
import type { DiffLine } from './text-diff';

/** Diff unificado (linhas removidas/adicionadas), com marcação acessível além da cor. */
@Component({
    selector: 'app-diff-view',
    template: `
        @if (identical()) {
            <p class="m-0 text-sm text-muted-color" role="status">No differences.</p>
        } @else {
            <div class="otto-code-view min-h-0 flex-1 overflow-auto rounded-md border border-surface-200 font-mono text-xs dark:border-surface-700" tabindex="0" role="region" [attr.aria-label]="label()">
                <table class="w-full border-collapse">
                    <caption class="sr-only">
                        {{
                            caption()
                        }}
                    </caption>
                    <tbody>
                        @for (line of lines(); track $index) {
                            @if (line.kind === 'skip') {
                                <tr class="bg-surface-100 text-muted-color dark:bg-surface-800">
                                    <td colspan="4" class="px-2 py-0.5">⋯ {{ line.count }} unchanged line(s)</td>
                                </tr>
                            } @else {
                                <tr [class]="rowClass(line.kind)">
                                    <td class="w-10 select-none px-2 text-right text-muted-color">{{ line.before ?? '' }}</td>
                                    <td class="w-10 select-none px-2 text-right text-muted-color">{{ line.after ?? '' }}</td>
                                    <td class="w-5 select-none text-center" aria-hidden="true">{{ line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : '' }}</td>
                                    <td class="whitespace-pre-wrap break-all pr-2">
                                        @if (line.kind !== 'same') {
                                            <span class="sr-only">{{ line.kind }}: </span>
                                        }
                                        {{ line.text }}
                                    </td>
                                </tr>
                            }
                        }
                    </tbody>
                </table>
            </div>
        }
    `,
    host: { class: 'flex min-h-0 flex-col' }
})
export class DiffView {
    readonly lines = input.required<DiffLine[]>();
    readonly label = input('Differences');

    protected readonly stats = computed(() => ({
        added: this.lines().filter((line) => line.kind === 'added').length,
        removed: this.lines().filter((line) => line.kind === 'removed').length
    }));
    protected readonly caption = computed(() => `${this.label()}: ${this.stats().removed} line(s) removed, ${this.stats().added} added`);
    protected readonly identical = computed(() => !this.stats().added && !this.stats().removed);

    protected rowClass(kind: 'same' | 'added' | 'removed'): string {
        return kind === 'added' ? 'bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200' : kind === 'removed' ? 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200' : '';
    }
}
