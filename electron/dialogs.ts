import { app, dialog } from 'electron';
import { APP_NAME, assetPath, REPOSITORY_URL } from './config';
import { getMainWindow } from './window';

export async function pickCollectionFolder(): Promise<string | null> {
    const options: Electron.OpenDialogOptions = {
        title: 'Open Collection',
        buttonLabel: 'Open',
        properties: ['openDirectory', 'createDirectory']
    };
    const win = getMainWindow();
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);

    return result.canceled ? null : (result.filePaths[0] ?? null);
}

/** Janela "Sobre" para Windows/Linux (no macOS usamos o painel nativo). */
export async function showAboutDialog(): Promise<void> {
    const options: Electron.MessageBoxOptions = {
        type: 'info',
        title: `About ${APP_NAME}`,
        message: `${APP_NAME} ${app.getVersion()}`,
        detail: ['Open-source, offline-first API client.', '', `Electron ${process.versions.electron}`, `Chromium ${process.versions.chrome}`, `Node.js ${process.versions.node}`, '', REPOSITORY_URL].join('\n'),
        icon: assetPath('icons', 'icon.png'),
        buttons: ['OK']
    };
    const win = getMainWindow();

    await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
}
