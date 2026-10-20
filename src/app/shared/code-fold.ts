import { DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';

/** Linguagens com blocos dobráveis. */
export type FoldLanguage = 'json' | 'xml';

/** Bloco dobrável: ao recolher, as linhas entre `start` e `end` (exclusive) ficam ocultas. */
interface FoldRange {
    start: number;
    end: number;
}

const XML_TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)(?:"[^"]*"|'[^']*'|[^'">])*?(\/?)>/g;

/** Blocos `{…}` e `[…]` que ocupam mais de duas linhas (ignora o conteúdo de strings). */
function jsonRanges(lines: string[]): FoldRange[] {
    const ranges: FoldRange[] = [];
    const stack: number[] = [];
    let inString = false;

    lines.forEach((line, lineIndex) => {
        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (inString) {
                if (char === '\\') i++;
                else if (char === '"') inString = false;
            } else if (char === '"') {
                inString = true;
            } else if (char === '{' || char === '[') {
                stack.push(lineIndex);
            } else if (char === '}' || char === ']') {
                const start = stack.pop();

                if (start !== undefined) ranges.push({ start, end: lineIndex });
            }
        }
    });

    return ranges;
}

/** Elementos XML/HTML cuja tag de abertura e de fechamento estão em linhas diferentes. */
function xmlRanges(lines: string[]): FoldRange[] {
    const text = lines.join('\n');
    const ranges: FoldRange[] = [];
    const stack: { name: string; line: number }[] = [];
    let line = 0;
    let cursor = 0;

    for (const match of text.matchAll(XML_TOKEN)) {
        for (; cursor < match.index; cursor++) {
            if (text[cursor] === '\n') line++;
        }

        const [, closing, opening, selfClosing] = match;

        if (opening && !selfClosing) {
            stack.push({ name: opening, line });
        } else if (closing) {
            // Tolera tags sem fechamento (HTML): desempilha até achar a correspondente.
            let index = stack.length - 1;

            while (index >= 0 && stack[index].name !== closing) index--;

            if (index >= 0) {
                ranges.push({ start: stack[index].line, end: line });
                stack.length = index;
            }
        }
    }

    return ranges;
}

/** Um bloco por linha inicial (o mais longo) e só os que têm linhas para ocultar. */
function foldRanges(lines: string[], language: FoldLanguage): Map<number, number> {
    const ends = new Map<number, number>();

    for (const { start, end } of language === 'json' ? jsonRanges(lines) : xmlRanges(lines)) {
        if (end - start > 1 && end > (ends.get(start) ?? -1)) ends.set(start, end);
    }

    return ends;
}

/**
 * Expandir/recolher blocos no código realçado. Atua sobre a tabela gerada pelo plugin
 * `lineNumbers` do ngx-highlightjs: põe um botão na calha das linhas que abrem um bloco
 * e oculta as linhas internas ao recolher (a linha de fechamento continua visível).
 */
@Directive({
    selector: 'code[highlight][lineNumbers][codeFold]',
    host: { '(click)': 'onClick($event)' }
})
export class HighlightCodeFold {
    readonly codeFold = input.required<FoldLanguage>();

    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    private rows: HTMLTableRowElement[] = [];
    private ends = new Map<number, number>();
    private readonly collapsed = new Set<number>();

    constructor() {
        // O plugin troca o conteúdo do <code> pela tabela de forma assíncrona a cada realce.
        const observer = new MutationObserver(() => this.decorate());

        observer.observe(this.host, { childList: true });
        inject(DestroyRef).onDestroy(() => observer.disconnect());
    }

    protected onClick(event: MouseEvent): void {
        const target = (event.target as Element).closest<HTMLElement>('[data-fold-line]');

        if (target && this.host.contains(target)) this.toggle(Number(target.dataset['foldLine']));
    }

    private decorate(): void {
        const table = this.host.firstElementChild;

        if (!(table instanceof HTMLTableElement) || table.dataset['folded'] !== undefined) return;

        table.dataset['folded'] = '';
        this.rows = Array.from(table.rows);
        this.ends = foldRanges(
            this.rows.map((row) => row.cells[1]?.textContent ?? ''),
            this.codeFold()
        );
        this.collapsed.clear();

        for (const [start, end] of this.ends) {
            const button = document.createElement('button');

            button.type = 'button';
            button.className = 'otto-fold-toggle';
            button.dataset['foldLine'] = String(start);
            button.innerHTML = '<span class="pi pi-chevron-down" aria-hidden="true"></span>';
            this.rows[start].cells[0]?.prepend(button);
            this.updateButton(start, end);
        }
    }

    private toggle(start: number): void {
        const end = this.ends.get(start);

        if (end === undefined) return;

        if (this.collapsed.has(start)) this.collapsed.delete(start);
        else this.collapsed.add(start);

        this.updateButton(start, end);
        this.applyVisibility();
    }

    private updateButton(start: number, end: number): void {
        const row = this.rows[start];
        const button = row.querySelector<HTMLButtonElement>('.otto-fold-toggle');
        const collapsed = this.collapsed.has(start);

        if (button) {
            button.setAttribute('aria-expanded', String(!collapsed));
            button.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} lines ${start + 2}–${end}`);
            button.firstElementChild?.classList.replace(collapsed ? 'pi-chevron-down' : 'pi-chevron-right', collapsed ? 'pi-chevron-right' : 'pi-chevron-down');
        }

        row.classList.toggle('otto-fold-collapsed', collapsed);
    }

    /** Oculta as linhas cobertas por algum bloco recolhido (contagem por diferenças, O(linhas)). */
    private applyVisibility(): void {
        const delta = new Int32Array(this.rows.length + 1);

        for (const start of this.collapsed) {
            const end = this.ends.get(start);

            if (end === undefined) continue;

            delta[start + 1]++;
            delta[end]--;
        }

        let depth = 0;

        this.rows.forEach((row, i) => {
            depth += delta[i];
            row.hidden = depth > 0;
        });
    }
}
