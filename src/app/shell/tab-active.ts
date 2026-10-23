import { computed, Directive, inject, InjectionToken, input, type Signal } from '@angular/core';

/**
 * Se a aba que contém o componente é a ativa. As abas visitadas continuam vivas em
 * segundo plano (`TabHost`): comandos de teclado registrados nelas só valem na ativa.
 * Fora de uma aba o token não existe (o componente é sempre considerado ativo).
 */
export const TAB_ACTIVE = new InjectionToken<Signal<boolean>>('TAB_ACTIVE');

/**
 * Fornece `TAB_ACTIVE` ao conteúdo de uma aba. Recebe o próprio signal (e não o valor)
 * porque a view de uma aba em segundo plano fica desanexada, sem change detection.
 *
 * Substitui o `injector` de `createEmbeddedView`: views com injector próprio fazem o
 * Angular ignorar o limite de `@Host()`, e o `ngModel` interno de componentes PrimeNG
 * (ex.: `p-select-button`) passava a achar o `formGroup` do formulário ao redor (NG01350).
 */
@Directive({
    selector: '[appTabActive]',
    providers: [{ provide: TAB_ACTIVE, useFactory: () => inject(TabActiveScope).active }]
})
export class TabActiveScope {
    readonly source = input.required<Signal<boolean>>({ alias: 'appTabActive' });
    readonly active = computed(() => this.source()());
}
