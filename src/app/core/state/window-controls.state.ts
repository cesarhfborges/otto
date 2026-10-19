import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { OTTO_API } from '../bridge/otto-api.token';
import { WindowGateway } from '../ports';

/** Estado da janela para a barra de título própria (maximizada, plataforma). */
@Injectable({ providedIn: 'root' })
export class WindowControlsState {
    private readonly gateway = inject(WindowGateway);
    private readonly maximizedState = signal(false);

    /** Dentro do Electron a barra de título é nossa; no navegador não há controles de janela. */
    readonly available = inject(OTTO_API) !== null;
    /** No macOS os botões nativos ("semáforo") ficam à esquerda e os nossos são ocultados. */
    readonly isMac = (inject(OTTO_API)?.platform ?? '') === 'darwin';
    readonly maximized = this.maximizedState.asReadonly();

    constructor() {
        if (!this.available) {
            return;
        }

        inject(DestroyRef).onDestroy(this.gateway.onStateChanged((state) => this.maximizedState.set(state.maximized)));
        this.gateway.state().then(
            (state) => this.maximizedState.set(state.maximized),
            () => undefined
        );
    }

    minimize(): void {
        void this.gateway.minimize();
    }

    toggleMaximize(): void {
        void this.gateway.toggleMaximize();
    }

    close(): void {
        void this.gateway.close();
    }

    /** Abre o menu da aplicação logo abaixo do elemento clicado. */
    showAppMenu(anchor: HTMLElement): void {
        const rect = anchor.getBoundingClientRect();

        void this.gateway.showAppMenu(Math.round(rect.left), Math.round(rect.bottom));
    }
}
