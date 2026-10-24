import { type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { Component, forwardRef, input, output } from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { TemplateField } from './template-field';

const suffixToken = (text: string, className: string): HTMLSpanElement => {
    const span = document.createElement('span');

    span.textContent = text;
    span.className = className;

    return span;
};

/** `{{variável}}`, número, `true/false/null` e pontuação ganham cores próprias dentro de nomes e valores. */
const SUFFIX_TOKENS = /(\{\{[^}]*\}\})|(?<![\w.])(-?\d+(?:\.\d+)?)(?![\w.])|\b(true|false|null)\b|(["'`/\\,:;|()[\]{}<>%+*#@!$^~-])/g;

function appendSuffixText(parent: HTMLElement, text: string, baseClass: string): void {
    let last = 0;

    for (const match of text.matchAll(SUFFIX_TOKENS)) {
        if (match.index > last) {
            parent.append(suffixToken(text.slice(last, match.index), baseClass));
        }

        const kind = match[1] ? 'var' : match[2] ? 'number' : match[3] ? 'keyword' : 'punct';

        parent.append(suffixToken(match[0], `otto-input-suffix-${kind}`));
        last = match.index + match[0].length;
    }

    if (last < text.length) {
        parent.append(suffixToken(text.slice(last), baseClass));
    }
}

/**
 * Texto fixo depois do conteúdo (ex.: a query montada pelos params); não é editável nem
 * selecionável. Uma query (`?a=1&b=2`) ganha cores por parte: separadores, nomes e valores.
 */
class SuffixWidget extends WidgetType {
    constructor(
        private readonly text: string,
        private readonly hint: string,
        private readonly onClick: (() => void) | null
    ) {
        super();
    }

    override eq(other: SuffixWidget): boolean {
        return other.text === this.text && other.hint === this.hint && !!other.onClick === !!this.onClick;
    }

    toDOM(): HTMLElement {
        const wrapper = document.createElement('span');
        let inValue = false;

        wrapper.className = 'otto-input-suffix';
        wrapper.title = this.hint;
        wrapper.setAttribute('aria-hidden', 'true');

        for (const part of this.text.split(/([?&=])/).filter(Boolean)) {
            if (part === '?' || part === '&') {
                wrapper.append(suffixToken(part, 'otto-input-suffix-amp'));
                inValue = false;
            } else if (part === '=') {
                wrapper.append(suffixToken(part, 'otto-input-suffix-eq'));
                inValue = true;
            } else {
                appendSuffixText(wrapper, part, inValue ? 'otto-input-suffix-value' : 'otto-input-suffix-key');
            }
        }

        if (this.onClick) {
            const onClick = this.onClick;

            wrapper.classList.add('otto-input-suffix-action');
            wrapper.addEventListener('mousedown', (event) => {
                event.preventDefault();
                event.stopPropagation();
                onClick();
            });
        }

        return wrapper;
    }

    override ignoreEvent(): boolean {
        return true;
    }
}

/**
 * Campo de uma linha com variáveis/comandos (`{{$.x}}`, `{{ otto.… }}`) exibidos como
 * chips e autocomplete (`{{` ou Ctrl+Space). Usa-se como um `pInputText`:
 * `[(ngModel)]`, `[formControl]`, `[(value)]`, `size`, `variant`, `fluid`, `invalid`…
 */
@Component({
    selector: 'app-otto-input',
    template: '',
    hostDirectives: [{ directive: InputText, inputs: ['pSize: size', 'variant', 'fluid'] }],
    providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => OttoInput), multi: true }],
    host: { '[class.otto-masked]': "type() === 'password'" }
})
export class OttoInput extends TemplateField {
    /** `password` mascara o texto, mas mantém os chips visíveis. */
    readonly type = input<'text' | 'password'>('text');
    /** Enter (sem a lista de sugestões aberta); o evento continua até o `form[appEnterSubmit]`. */
    readonly enter = output<KeyboardEvent>();
    /** Texto somente leitura exibido logo após o valor (não faz parte dele). */
    readonly suffix = input('');
    /** Dica (tooltip) do sufixo. */
    readonly suffixHint = input('');
    /** Clique no sufixo (ex.: abrir a aba Params). */
    readonly suffixClick = output<void>();

    protected readonly multiline = false;

    protected override extraContentAttributes(): Record<string, string> {
        return { 'aria-multiline': 'false' };
    }

    protected override extraExtensions(): Extension[] {
        const suffix = this.suffix();

        if (!suffix) {
            return [];
        }

        const widget = Decoration.widget({ widget: new SuffixWidget(suffix, this.suffixHint(), () => this.suffixClick.emit()), side: 1 });

        return [EditorView.decorations.of((view) => Decoration.set([widget.range(view.state.doc.length)]))];
    }

    protected override onEnter(event: KeyboardEvent): boolean {
        this.enter.emit(event);

        return true;
    }
}
