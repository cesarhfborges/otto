import type { DialogService } from './dialogs';
import type { WindowManager } from './window';

/** Comandos compartilhados pelo menu da aplicação e pelo tray. */
export class AppCommands {
    constructor(
        private readonly window: WindowManager,
        private readonly dialogs: DialogService
    ) {}

    newRequest(): void {
        this.window.sendMenuAction({ type: 'new-request' });
    }

    newCollection(): void {
        this.window.sendMenuAction({ type: 'new-collection' });
    }

    importCollection(): void {
        this.window.sendMenuAction({ type: 'import-collection' });
    }

    save(): void {
        this.window.sendMenuAction({ type: 'save' });
    }

    openSettings(): void {
        this.window.sendMenuAction({ type: 'open-settings' });
    }

    toggleTheme(): void {
        this.window.sendMenuAction({ type: 'toggle-theme' });
    }

    showAbout(): void {
        void this.dialogs.showAbout();
    }
}
