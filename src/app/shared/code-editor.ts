import { Component, computed, ElementRef, input, model, viewChild } from '@angular/core';
import { highlightCode, type HighlightLanguage } from './highlight';

/**
 * Textarea com realce de sintaxe: o texto real fica transparente sobre um `<pre>` realçado
 * com a mesma fonte, espaçamento e rolagem.
 */
@Component({
    selector: 'app-code-editor',
    template: `
        <pre #mirror class="otto-code pointer-events-none absolute inset-0 m-0 overflow-hidden" aria-hidden="true"><code [innerHTML]="html()"></code></pre>
        <textarea
            class="otto-code relative block min-h-64 w-full resize-y bg-transparent text-transparent caret-[var(--p-text-color)] placeholder:text-muted-color focus-visible:outline-2 focus-visible:outline-[var(--p-primary-color)]"
            [id]="inputId()"
            [value]="value()"
            [placeholder]="placeholder()"
            wrap="off"
            spellcheck="false"
            autocomplete="off"
            [attr.aria-invalid]="invalid()"
            [attr.aria-describedby]="describedBy()"
            (input)="value.set($any($event.target).value)"
            (scroll)="syncScroll($any($event.target))"
        ></textarea>
    `,
    host: { class: 'relative block rounded-md border border-surface-300 bg-surface-0 dark:border-surface-700 dark:bg-surface-950' }
})
export class CodeEditor {
    readonly value = model('');
    readonly language = input<HighlightLanguage | null>(null);
    readonly inputId = input<string | null>(null);
    readonly placeholder = input('');
    readonly invalid = input(false);
    readonly describedBy = input<string | null>(null);

    private readonly mirror = viewChild.required<ElementRef<HTMLPreElement>>('mirror');

    // A quebra final extra mantém a última linha vazia com altura igual à do textarea.
    protected readonly html = computed(() => highlightCode(this.value(), this.language()) + '\n');

    protected syncScroll(textarea: HTMLTextAreaElement): void {
        const pre = this.mirror().nativeElement;

        pre.scrollTop = textarea.scrollTop;
        pre.scrollLeft = textarea.scrollLeft;
    }
}
