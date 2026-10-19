import { app, Menu, nativeImage, Tray } from 'electron';
import { APP_NAME, assetPath, isMac, isWindows } from '../config';
import type { ISettingsService } from '../core/contracts';
import type { AppCommands } from './commands';
import type { WindowManager } from './window';

const trayIconFile = (): string => {
    if (isMac) {
        return 'trayTemplate.png'; // "Template" faz o macOS adaptar o ícone ao tema claro/escuro.
    }

    return isWindows ? 'tray-16.png' : 'tray-32.png';
};

/** Ícone e menu da bandeja do sistema. */
export class TrayManager {
    private tray: Tray | null = null;
    private unsubscribeSettings: (() => void) | null = null;
    private readonly refresh = () => this.tray?.setContextMenu(this.buildMenu());

    constructor(
        private readonly window: WindowManager,
        private readonly settings: ISettingsService,
        private readonly commands: AppCommands
    ) {}

    create(): Tray | null {
        try {
            const icon = nativeImage.createFromPath(assetPath('icons', trayIconFile()));

            if (isMac) {
                icon.setTemplateImage(true);
            }

            this.tray = new Tray(icon);
        } catch (error) {
            // Alguns ambientes Linux não possuem área de notificação; o app segue sem tray.
            console.warn('[otto] Tray indisponível:', error);
            this.window.setTrayAvailable(false);

            return null;
        }

        this.tray.setToolTip(APP_NAME);
        this.refresh();

        // No Linux (AppIndicator) o clique simples nem sempre é emitido; o menu de contexto cobre esse caso.
        if (!isMac) {
            this.tray.on('click', () => this.window.toggle());
        }

        this.tray.on('double-click', () => this.window.show());
        this.window.events.on('visibility-changed', this.refresh);
        // A opção "manter na bandeja" também pode mudar pelo painel de configurações.
        this.unsubscribeSettings = this.settings.onChange(this.refresh);
        this.window.setTrayAvailable(true);

        return this.tray;
    }

    destroy(): void {
        this.window.events.off('visibility-changed', this.refresh);
        this.unsubscribeSettings?.();
        this.unsubscribeSettings = null;
        this.tray?.destroy();
        this.tray = null;
        this.window.setTrayAvailable(false);
    }

    private buildMenu(): Menu {
        return Menu.buildFromTemplate([
            { label: this.window.isVisible ? `Hide ${APP_NAME}` : `Show ${APP_NAME}`, click: () => this.window.toggle() },
            { type: 'separator' },
            { label: 'New Request', click: () => this.commands.newRequest() },
            { label: 'New Collection', click: () => this.commands.newCollection() },
            { type: 'separator' },
            {
                label: 'Keep running in tray when closed',
                type: 'checkbox',
                checked: this.settings.get().minimizeToTray,
                click: (item) => this.settings.update({ minimizeToTray: item.checked })
            },
            { type: 'separator' },
            { label: `Quit ${APP_NAME}`, click: () => app.quit() }
        ]);
    }
}
