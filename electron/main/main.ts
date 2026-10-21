import { app, BrowserWindow, dialog, Menu } from 'electron';
import { APP_ID, APP_NAME, isMac, isWindows, REPOSITORY_URL } from './config';
import { createContainer, type Container } from './container';
import { ElectronIpcRegistrar } from './ipc/handle';
import { buildAppMenu } from './ui/menu';

app.setName(APP_NAME);

if (isWindows) {
    app.setAppUserModelId(APP_ID);
}

let container: Container | null = null;

if (!app.requestSingleInstanceLock()) {
    // Já existe uma instância aberta: ela recebe o foco via `second-instance`.
    app.quit();
} else {
    app.on('second-instance', () => container?.window.show());

    app.on('before-quit', () => container?.window.markQuitting());

    app.on('will-quit', () => container?.dispose());

    app.on('window-all-closed', () => {
        if (!isMac) {
            app.quit();
        }
    });

    app.on('activate', () => {
        if (!container) {
            return;
        }

        if (BrowserWindow.getAllWindows().length === 0) {
            container.window.create();
        } else {
            container.window.show();
        }
    });

    void app.whenReady().then(() => {
        app.setAboutPanelOptions({
            applicationName: APP_NAME,
            applicationVersion: app.getVersion(),
            website: REPOSITORY_URL
        });

        try {
            container = createContainer();
        } catch (error) {
            // Falha ao abrir/migrar o banco local: sem ele o app não funciona.
            dialog.showErrorBox(`${APP_NAME} failed to start`, error instanceof Error ? error.message : String(error));
            app.exit(1);

            return;
        }

        const ipc = new ElectronIpcRegistrar();

        for (const module of container.ipcModules) {
            module.register(ipc);
        }

        container.theme.start();
        const { commands, keybindings } = container;
        const applyMenu = () => Menu.setApplicationMenu(buildAppMenu(commands, keybindings.get()));

        // O menu exibe os atalhos configurados: reconstrói quando o usuário os altera.
        applyMenu();
        keybindings.onChange(applyMenu);
        container.tray.create();
        container.window.create();
    });
}
