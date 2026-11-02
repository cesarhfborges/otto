import { booleanAttribute, Component, computed, input, model, signal } from '@angular/core';
import { Highlight } from 'ngx-highlightjs';
import { type HighlightLanguage, highlightLanguageFor } from './highlight';

/**
 * Textarea com realce de sintaxe: o texto real fica transparente sobre um `<pre>` realçado
 * com a mesma fonte, espaçamento e rolagem. Os números de linha ficam numa calha à parte
 * (o plugin `lineNumbers` troca o `<code>` por uma tabela e quebraria o alinhamento).
 */
@Component({
    selector: 'app-code-editor',
    imports: [Highlight],
    template: `
        <div class="otto-code otto-code-gutter shrink-0 overflow-hidden border-r border-surface-200 dark:border-surface-700" aria-hidden="true">
            <div [style.transform]="gutterOffset()">{{ lineNumbers() }}</div>
        </div>
        <div class="relative flex min-w-0 flex-1 flex-col">
            <pre class="otto-code pointer-events-none absolute inset-0 m-0 overflow-hidden !outline-none" aria-hidden="true"><span class="block" [style.transform]="mirrorOffset()">@switch (highlightLanguage()) {
                @case ('json') {<code [highlight]="mirrorText()" language="json" ignoreIllegals></code>}
                @case ('xml') {<code [highlight]="mirrorText()" language="xml" ignoreIllegals></code>}
                @default {<code>{{ mirrorText() }}</code>}
            }</span></pre>
            <textarea
                class="otto-code otto-code-input relative block min-h-0 w-full flex-1 resize-none bg-transparent text-transparent caret-(--p-text-color) placeholder:text-muted-color !outline-none"
                [id]="inputId()"
                [value]="value()"
                [placeholder]="placeholder()"
                [readOnly]="readonly()"
                wrap="soft"
                spellcheck="false"
                autocomplete="off"
                [attr.aria-invalid]="invalid()"
                [attr.aria-describedby]="describedBy()"
                [attr.aria-label]="ariaLabel()"
                (input)="value.set($any($event.target).value)"
                (scroll)="syncScroll($any($event.target))"
            ></textarea>
        </div>
    `,
    host: { class: 'relative flex min-h-64 rounded-md border border-surface-300 bg-surface-0 dark:border-surface-700 dark:bg-surface-950' }
})
export class CodeEditor {
    readonly value = model('');
    readonly language = input<HighlightLanguage | null>(null);
    readonly readonly = input(false, { transform: booleanAttribute });
    readonly inputId = input<string | null>(null);
    readonly placeholder = input('');
    readonly invalid = input(false);
    readonly describedBy = input<string | null>(null);
    /** Nome acessível quando não há `<label for>` (ex.: corpo da resposta). */
    readonly ariaLabel = input<string | null>(null);
    // A quebra final extra mantém a última linha vazia com altura igual à do textarea.
    protected readonly mirrorText = computed(() => this.value() + '\n');
    protected readonly lineNumbers = computed(() => {
        const count = this.value().split('\n').length;

        return Array.from({ length: count }, (_, i) => i + 1).join('\n') + '\n';
    });
    // O `language` da diretiva não é reativo: o @switch recria o <code> quando a linguagem muda.
    protected readonly highlightLanguage = computed(() => highlightLanguageFor(this.value(), this.language()));
    /**
     * Rolagem do textarea replicada por `transform` no espelho e na calha. Copiar o `scrollTop`
     * não serve: o `<pre>` não tem a barra horizontal do textarea nem desenha a quebra final, então
     * rola menos e, perto do fim, o texto realçado fica deslocado (a "sombra" vista ao selecionar).
     */
    private readonly scroll = signal({ top: 0, left: 0 });
    protected readonly mirrorOffset = computed(() => `translate(${-this.scroll().left}px, ${-this.scroll().top}px)`);
    protected readonly gutterOffset = computed(() => `translateY(${-this.scroll().top}px)`);

    protected syncScroll(textarea: HTMLTextAreaElement): void {
        this.scroll.set({ top: textarea.scrollTop, left: textarea.scrollLeft });
    }
}
