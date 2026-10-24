import { booleanAttribute, Component, effect, forwardRef, inject, input, numberAttribute } from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import type { Extension } from '@codemirror/state';
import { Decoration, lineNumbers } from '@codemirror/view';
import { HighlightJS } from 'ngx-highlightjs';
import { InputText } from 'primeng/inputtext';
import { type HighlightLanguage, highlightLanguageFor } from '../highlight';
import { highlightDecorations, highlightField, setHighlight } from './template-highlight';
import { TemplateField } from './template-field';

/**
 * Versão de várias linhas do `app-otto-input` (como `pTextarea`: `rows`, `autoResize`), com
 * realce de sintaxe do highlight.js (`language`, desligável com `[highlight]="false"`) e
 * números de linha opcionais.
 */
@Component({
    selector: 'app-otto-textarea',
    template: '',
    hostDirectives: [{ directive: InputText, inputs: ['pSize: size', 'variant', 'fluid'] }],
    providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => OttoTextarea), multi: true }],
    host: { '[style.--otto-rows]': 'rows()', '[class.otto-auto-resize]': 'autoResize()' }
})
export class OttoTextarea extends TemplateField {
    readonly rows = input(3, { transform: numberAttribute });
    /** Cresce com o conteúdo (senão rola a partir de `rows` linhas). */
    readonly autoResize = input(false, { transform: booleanAttribute });
    /** Realce de sintaxe (com `language`). */
    readonly highlight = input(true, { transform: booleanAttribute });
    readonly language = input<HighlightLanguage | null>(null);
    readonly lineNumbers = input(false, { transform: booleanAttribute });

    protected readonly multiline = true;

    private readonly hljs = inject(HighlightJS);

    constructor() {
        super();

        effect((onCleanup) => {
            const view = this.editorView();
            const code = this.value() ?? '';
            const language = this.highlight() ? highlightLanguageFor(code, this.language()) : null;

            if (!view) {
                return;
            }

            if (!language) {
                if (view.state.field(highlightField).size) {
                    view.dispatch({ effects: setHighlight.of(Decoration.none) });
                }

                return;
            }

            let stale = false;

            onCleanup(() => (stale = true));
            // O realce é assíncrono: só vale se o texto não mudou enquanto era calculado.
            void this.hljs.highlight(code, { language, ignoreIllegals: true }).then((result) => {
                if (!stale && view.state.doc.toString() === code) {
                    view.dispatch({ effects: setHighlight.of(highlightDecorations(result.value)) });
                }
            });
        });
    }

    protected override extraExtensions(): Extension[] {
        return [highlightField, ...(this.lineNumbers() ? [lineNumbers()] : [])];
    }
}
