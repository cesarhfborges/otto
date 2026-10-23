import { type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { Component, forwardRef, input, output } from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { TemplateField } from './template-field';

/** Texto fixo depois do conteúdo (ex.: a query montada pelos params); não é editável nem selecionável. */
class SuffixWidget extends WidgetType {
    constructor(
        private readonly text: string,
        private readonly hint: string
    ) {
        super();
    }

    override eq(other: SuffixWidget): boolean {
        return other.text === this.text && other.hint === this.hint;
    }

    toDOM(): HTMLElement {
        const span = document.createElement('span');

        span.className = 'otto-input-suffix';
        span.textContent = this.text;
        span.title = this.hint;

        return span;
    }

    override ignoreEvent(): boolean {
        return false;
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

    protected readonly multiline = false;

    protected override extraContentAttributes(): Record<string, string> {
        return { 'aria-multiline': 'false' };
    }

    protected override extraExtensions(): Extension[] {
        const suffix = this.suffix();

        if (!suffix) {
            return [];
        }

        const widget = Decoration.widget({ widget: new SuffixWidget(suffix, this.suffixHint()), side: 1 });

        return [EditorView.decorations.of((view) => Decoration.set([widget.range(view.state.doc.length)]))];
    }

    protected override onEnter(event: KeyboardEvent): boolean {
        this.enter.emit(event);

        return true;
    }
}
