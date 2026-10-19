import { Directive, ElementRef, inject } from '@angular/core';

/**
 * Enter num campo de texto envia o formulário (`ngSubmit`). Necessário nos diálogos:
 * o botão de envio fica no rodapé do `p-dialog`, fora do `<form>`, e sem botão
 * de envio interno o navegador não faz a submissão implícita com vários campos.
 */
@Directive({
    selector: 'form[appEnterSubmit]',
    host: { '(keydown.enter)': 'onEnter($event)' }
})
export class EnterSubmit {
    private readonly form = inject<ElementRef<HTMLFormElement>>(ElementRef).nativeElement;

    protected onEnter(event: Event): void {
        const target = event.target;

        if (target instanceof HTMLInputElement && !target.readOnly) {
            event.preventDefault();
            this.form.requestSubmit();
        }
    }
}
