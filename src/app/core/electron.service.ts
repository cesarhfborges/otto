import { DestroyRef, inject, Injectable } from '@angular/core';
import type { MenuAction, OttoApi } from '../../../electron/shared/contract';

@Injectable({ providedIn: 'root' })
export class ElectronService {
    private readonly destroyRef = inject(DestroyRef);

    /** API do Electron, ou `null` quando o app roda no navegador (`npm run web:serve`). */
    readonly api: OttoApi | null = window.otto ?? null;

    get isElectron(): boolean {
        return this.api !== null;
    }

    /** Escuta ações vindas do menu da aplicação e do tray. */
    onMenuAction(listener: (action: MenuAction) => void): void {
        const unsubscribe = this.api?.onMenuAction(listener);

        if (unsubscribe) {
            this.destroyRef.onDestroy(unsubscribe);
        }
    }
}
