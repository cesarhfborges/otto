import { app, BrowserWindow, Menu } from 'electron';
import { APP_ID, APP_NAME, isMac, isWindows, REPOSITORY_URL } from './config';
import { registerAppIpc } from './ipc/app.ipc';
import { registerHttpIpc } from './ipc/http.ipc';
import { buildAppMenu } from './menu';
import { createTray } from './tray';
import { createMainWindow, markQuitting, showMainWindow } from './window';

app.setName(APP_NAME);

if (isWindows) {
    app.setAppUserModelId(APP_ID);
}

if (!app.requestSingleInstanceLock()) {
    // Já existe uma instância aberta: ela recebe o foco via `second-instance`.
    app.quit();
} else {
    app.on('second-instance', () => showMainWindow());

    app.on('before-quit', markQuitting);

    app.on('window-all-closed', () => {
        if (!isMac) {
            app.quit();
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        } else {
            showMainWindow();
        }
    });

    void app.whenReady().then(() => {
        app.setAboutPanelOptions({
            applicationName: APP_NAME,
            applicationVersion: app.getVersion(),
            website: REPOSITORY_URL
        });

        registerAppIpc();
        registerHttpIpc();

        Menu.setApplicationMenu(buildAppMenu());
        createTray();
        createMainWindow();
    });
}
