import { app, Menu, nativeImage, Tray } from 'electron';
import { APP_NAME, assetPath, isMac, isWindows } from '../config';
import type { ISettingsService } from '../core/contracts';
import type { WindowManager } from './window';

const trayIconFile = (): string => {
    if (isMac) {
        return 'trayTemplate.png'; // "Template" faz o macOS adaptar o ícone ao tema claro/escuro.
    }

    return isWindows ? 'tray-16.png' : 'tray-32.png';
};

/** Ícone e menu da bandeja do sistema; exibido só quando habilitado nas configurações. */
export class TrayManager {
    private tray: Tray | null = null;
    private unsubscribeSettings: (() => void) | null = null;
    private readonly refresh = () => this.tray?.setContextMenu(this.buildMenu());

    constructor(
        private readonly window: WindowManager,
        private readonly settings: ISettingsService
    ) {}

    /** Cria ou remove o ícone conforme a preferência `showTrayIcon`, acompanhando suas mudanças. */
    start(): void {
        const sync = () => (this.settings.get().showTrayIcon ? this.create() : this.destroy());

        sync();
        this.unsubscribeSettings = this.settings.onChange(sync);
    }

    stop(): void {
        this.unsubscribeSettings?.();
        this.unsubscribeSettings = null;
        this.destroy();
    }

    private create(): void {
        if (this.tray) {
            return;
        }

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

            return;
        }

        this.tray.setToolTip(APP_NAME);
        this.refresh();

        // No Linux (AppIndicator) o clique simples nem sempre é emitido; o menu de contexto cobre esse caso.
        if (!isMac) {
            this.tray.on('click', () => this.window.toggle());
        }

        this.tray.on('double-click', () => this.window.show());
        this.window.events.on('visibility-changed', this.refresh);
        this.window.setTrayAvailable(true);
    }

    private destroy(): void {
        if (!this.tray) {
            return;
        }

        this.window.events.off('visibility-changed', this.refresh);
        this.tray.destroy();
        this.tray = null;
        this.window.setTrayAvailable(false);
    }

    private buildMenu(): Menu {
        return Menu.buildFromTemplate([
            { label: this.window.isVisible ? `Hide ${APP_NAME}` : `Show ${APP_NAME}`, click: () => this.window.toggle() },
            { type: 'separator' },
            { label: `Quit ${APP_NAME}`, click: () => app.quit() }
        ]);
    }
}
