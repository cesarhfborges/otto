import { Component, forwardRef, input, output } from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { TemplateField } from './template-field';

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

    protected readonly multiline = false;

    protected override extraContentAttributes(): Record<string, string> {
        return { 'aria-multiline': 'false' };
    }

    protected override onEnter(event: KeyboardEvent): boolean {
        this.enter.emit(event);

        return true;
    }
}
