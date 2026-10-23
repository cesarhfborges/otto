import { InjectionToken, type Signal } from '@angular/core';

/**
 * Se a aba que contém o componente é a ativa. As abas visitadas continuam vivas em
 * segundo plano (`TabHost`): comandos de teclado registrados nelas só valem na ativa.
 * Fora de uma aba o token não existe (o componente é sempre considerado ativo).
 */
export const TAB_ACTIVE = new InjectionToken<Signal<boolean>>('TAB_ACTIVE');
