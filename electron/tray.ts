import { app, Menu, nativeImage, Tray } from 'electron';
import { APP_NAME, assetPath, isMac, isWindows } from './config';
import { openCollection } from './menu';
import { settings } from './settings';
import { isMainWindowVisible, sendMenuAction, setTrayAvailable, showMainWindow, toggleMainWindow, windowEvents } from './window';

let tray: Tray | null = null;

const trayIconFile = (): string => {
    if (isMac) {
        return 'trayTemplate.png'; // "Template" faz o macOS adaptar o ícone ao tema claro/escuro.
    }

    return isWindows ? 'tray-16.png' : 'tray-32.png';
};

function buildTrayMenu(): Menu {
    const visible = isMainWindowVisible();

    return Menu.buildFromTemplate([
        { label: visible ? `Hide ${APP_NAME}` : `Show ${APP_NAME}`, click: () => toggleMainWindow() },
        { type: 'separator' },
        { label: 'New Request', click: () => sendMenuAction({ type: 'new-request' }) },
        { label: 'Open Collection…', click: () => void openCollection() },
        { type: 'separator' },
        {
            label: 'Keep running in tray when closed',
            type: 'checkbox',
            checked: settings.getPublic().minimizeToTray,
            click: (item) => settings.setPublic({ minimizeToTray: item.checked })
        },
        { type: 'separator' },
        { label: `Quit ${APP_NAME}`, click: () => app.quit() }
    ]);
}

function refreshTrayMenu(): void {
    tray?.setContextMenu(buildTrayMenu());
}

export function createTray(): Tray | null {
    try {
        const icon = nativeImage.createFromPath(assetPath('icons', trayIconFile()));

        if (isMac) {
            icon.setTemplateImage(true);
        }

        tray = new Tray(icon);
    } catch (error) {
        // Alguns ambientes Linux não possuem área de notificação; o app segue sem tray.
        console.warn('[otto] Tray indisponível:', error);
        setTrayAvailable(false);

        return null;
    }

    tray.setToolTip(APP_NAME);
    refreshTrayMenu();

    // No Linux (AppIndicator) o clique simples nem sempre é emitido; o menu de contexto cobre esse caso.
    if (!isMac) {
        tray.on('click', () => toggleMainWindow());
    }

    tray.on('double-click', () => showMainWindow());
    windowEvents.on('visibility-changed', refreshTrayMenu);
    setTrayAvailable(true);

    return tray;
}

export function destroyTray(): void {
    windowEvents.off('visibility-changed', refreshTrayMenu);
    tray?.destroy();
    tray = null;
    setTrayAvailable(false);
}
