import { BrowserWindow, screen, shell, type Rectangle } from 'electron';
import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { APP_NAME, assetPath, isDev, isMac, rendererIndexPath, rendererUrl } from './config';
import { settings } from './settings';
import type { MenuAction } from './shared/contract';

let mainWindow: BrowserWindow | null = null;
let quitting = false;
let trayAvailable = false;

/** Emite `visibility-changed` sempre que a janela é exibida ou ocultada (usado pelo tray). */
export const windowEvents = new EventEmitter();

export const markQuitting = (): void => {
    quitting = true;
};

export const setTrayAvailable = (available: boolean): void => {
    trayAvailable = available;
};

export const getMainWindow = (): BrowserWindow | null => mainWindow;

export const isMainWindowVisible = (): boolean => !!mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized();

const isOnSomeDisplay = (bounds: Rectangle): boolean => screen.getAllDisplays().some(({ workArea: a }) => bounds.x < a.x + a.width && bounds.x + bounds.width > a.x && bounds.y < a.y + a.height && bounds.y + bounds.height > a.y);

const isExternalUrl = (url: string): boolean => (isDev ? !url.startsWith(rendererUrl) : !url.startsWith('file://'));

export function createMainWindow(): BrowserWindow {
    const saved = settings.windowBounds;
    const bounds = saved && isOnSomeDisplay(saved) ? saved : { width: 1280, height: 800 };

    mainWindow = new BrowserWindow({
        ...bounds,
        minWidth: 900,
        minHeight: 600,
        title: APP_NAME,
        icon: assetPath('icons', 'icon.png'),
        show: false,
        autoHideMenuBar: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    mainWindow.once('ready-to-show', () => mainWindow?.show());

    // Links externos abrem no navegador padrão; o app nunca navega para fora.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) {
            void shell.openExternal(url);
        }

        return { action: 'deny' };
    });

    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (isExternalUrl(url)) {
            event.preventDefault();
        }
    });

    for (const evt of ['show', 'hide', 'minimize', 'restore'] as const) {
        mainWindow.on(evt as 'show', () => windowEvents.emit('visibility-changed'));
    }

    mainWindow.on('close', (event) => {
        if (mainWindow && !mainWindow.isMinimized() && !mainWindow.isFullScreen()) {
            settings.windowBounds = mainWindow.getNormalBounds();
        }

        const keepInTray = isMac || (trayAvailable && settings.getPublic().minimizeToTray);

        if (!quitting && keepInTray) {
            event.preventDefault();
            mainWindow?.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        windowEvents.emit('visibility-changed');
    });

    if (isDev) {
        void mainWindow.loadURL(rendererUrl);
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        void mainWindow.loadFile(rendererIndexPath());
    }

    return mainWindow;
}

export function showMainWindow(): BrowserWindow {
    const win = mainWindow ?? createMainWindow();

    if (win.isMinimized()) {
        win.restore();
    }

    win.show();
    win.focus();

    return win;
}

export function toggleMainWindow(): void {
    if (isMainWindowVisible() && mainWindow?.isFocused()) {
        mainWindow.hide();
    } else {
        showMainWindow();
    }
}

/** Exibe a janela e encaminha a ação para o Angular. */
export function sendMenuAction(action: MenuAction): void {
    const win = showMainWindow();
    const send = () => win.webContents.send('menu:action', action);

    if (win.webContents.isLoading()) {
        win.webContents.once('did-finish-load', send);
    } else {
        send();
    }
}
