import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { UpdateState } from '@shared/models';
import { OTTO_API } from '../bridge/otto-api.token';
import { ipcErrorMessage } from '../bridge/ipc-error';
import { UpdatesGateway } from '../ports';

/** Atualizações do app (GitHub Releases) e visibilidade da janela de atualização. */
@Injectable({ providedIn: 'root' })
export class UpdatesState {
    private readonly gateway = inject(UpdatesGateway);
    private readonly current = signal<UpdateState | null>(null);
    private readonly dialogVisible = signal(false);

    readonly available = inject(OTTO_API) !== null;
    readonly state = this.current.asReadonly();
    readonly dialogOpen = this.dialogVisible.asReadonly();
    /** Há algo a mostrar na barra de status (versão nova, download ou reinício pendente). */
    readonly pending = computed(() => {
        const phase = this.current()?.phase;

        return phase === 'available' || phase === 'downloading' || phase === 'downloaded';
    });

    constructor() {
        if (!this.available) {
            return;
        }

        const destroyRef = inject(DestroyRef);

        destroyRef.onDestroy(this.gateway.onStateChanged((state) => this.current.set(state)));
        destroyRef.onDestroy(this.gateway.onOpenRequested(() => this.openAndCheck()));
        this.gateway.state().then(
            (state) => this.current.set(state),
            () => undefined
        );
    }

    open(): void {
        this.dialogVisible.set(true);
    }

    close(): void {
        this.dialogVisible.set(false);
    }

    /** "Check for Updates…" (menu, bandeja, Preferences): abre a janela já verificando. */
    openAndCheck(): void {
        this.open();
        void this.check();
    }

    async check(): Promise<void> {
        try {
            this.current.set(await this.gateway.check());
        } catch (error) {
            this.current.update((state) => (state ? { ...state, phase: 'error', error: ipcErrorMessage(error) } : state));
        }
    }

    download(): void {
        void this.gateway.download();
    }

    install(): void {
        void this.gateway.install();
    }

    skip(): void {
        const version = this.current()?.info?.version;

        if (version) {
            void this.gateway.skip(version);
        }

        this.close();
    }

    remindLater(): void {
        void this.gateway.remindLater();
        this.close();
    }

    clearSkipped(): void {
        void this.gateway.clearSkipped();
    }

    openRelease(): void {
        void this.gateway.openRelease();
    }
}
