import { DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';

const TOGGLE_SELECTOR = '[data-pc-section="nodetogglebutton"]:not([aria-label])';
const DEFAULT_LABEL = 'Expand or collapse';

/**
 * Dá nome acessível aos botões de expandir do `p-tree` (WCAG 4.1.2 / axe `button-name`).
 * No PrimeNG 21 o input `togglerAriaLabel` não é aplicado e o pass-through `pt`
 * só chega ao primeiro nível; os nós aninhados são criados ao expandir, por isso
 * observamos as mudanças do DOM da árvore.
 */
@Directive({ selector: 'p-tree[appTreeToggleLabel]' })
export class TreeToggleLabel {
    /** Usado como atributo sem valor (`appTreeToggleLabel`), o input chega como ''. */
    readonly appTreeToggleLabel = input(DEFAULT_LABEL, { transform: (value: string | undefined) => value || DEFAULT_LABEL });

    constructor() {
        const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
        const label = () => host.querySelectorAll<HTMLElement>(TOGGLE_SELECTOR).forEach((button) => button.setAttribute('aria-label', this.appTreeToggleLabel()));
        const observer = new MutationObserver(label);

        observer.observe(host, { childList: true, subtree: true });
        queueMicrotask(label);
        inject(DestroyRef).onDestroy(() => observer.disconnect());
    }
}
