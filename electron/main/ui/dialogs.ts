import { app, dialog, type BrowserWindow } from 'electron';
import { APP_NAME, assetPath, REPOSITORY_URL } from '../config';

/** Diálogos nativos, ancorados na janela principal quando ela existe. */
export class DialogService {
    constructor(private readonly parent: () => BrowserWindow | null) {}

    async pickCollectionFolder(): Promise<string | null> {
        const options: Electron.OpenDialogOptions = {
            title: 'Open Collection',
            buttonLabel: 'Open',
            properties: ['openDirectory', 'createDirectory']
        };
        const win = this.parent();
        const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);

        return result.canceled ? null : (result.filePaths[0] ?? null);
    }

    async pickCertificateFile(): Promise<string | null> {
        const options: Electron.OpenDialogOptions = {
            title: 'Select CA Certificate',
            buttonLabel: 'Select',
            properties: ['openFile'],
            filters: [
                { name: 'Certificates', extensions: ['pem', 'crt', 'cer'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        };
        const win = this.parent();
        const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);

        return result.canceled ? null : (result.filePaths[0] ?? null);
    }

    /** Janela "Sobre" para Windows/Linux (no macOS usamos o painel nativo). */
    async showAbout(): Promise<void> {
        const options: Electron.MessageBoxOptions = {
            type: 'info',
            title: `About ${APP_NAME}`,
            message: `${APP_NAME} ${app.getVersion()}`,
            detail: ['Open-source, offline-first API client.', '', `Electron ${process.versions.electron}`, `Chromium ${process.versions.chrome}`, `Node.js ${process.versions.node}`, '', REPOSITORY_URL].join('\n'),
            icon: assetPath('icons', 'icon.png'),
            buttons: ['OK']
        };
        const win = this.parent();

        await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
    }
}
