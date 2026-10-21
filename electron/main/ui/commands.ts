import type { CommandId } from '../../shared/models';
import type { DialogService } from './dialogs';
import type { WindowManager } from './window';

/** Comandos compartilhados pelo menu da aplicação e pelo tray. */
export class AppCommands {
    constructor(
        private readonly window: WindowManager,
        private readonly dialogs: DialogService
    ) {}

    /** Executa um comando do renderer (o mesmo dos atalhos de teclado). */
    run(id: CommandId): void {
        this.window.sendMenuAction({ type: 'command', id });
    }

    showAbout(): void {
        void this.dialogs.showAbout();
    }
}
