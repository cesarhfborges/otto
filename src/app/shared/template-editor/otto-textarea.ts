import { booleanAttribute, Component, forwardRef, input, numberAttribute } from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { TemplateField } from './template-field';

/** Versão de várias linhas do `app-otto-input` (como `pTextarea`: `rows`, `autoResize`). */
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

    protected readonly multiline = true;
}
