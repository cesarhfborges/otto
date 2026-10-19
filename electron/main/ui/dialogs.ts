import { app, dialog, type BrowserWindow } from 'electron';
import { APP_NAME, assetPath, REPOSITORY_URL } from '../config';

/** Diálogos nativos, ancorados na janela principal quando ela existe. */
export class DialogService {
    constructor(private readonly parent: () => BrowserWindow | null) {}

    /** Pasta de uma coleção a importar (será copiada para o workspace). */
    pickCollectionFolder(): Promise<string | null> {
        return this.pickPath({ title: 'Import Collection from Folder', buttonLabel: 'Import', properties: ['openDirectory'] });
    }

    pickCollectionArchive(): Promise<string | null> {
        return this.pickPath({ title: 'Import Collection', buttonLabel: 'Import', properties: ['openFile'], filters: [{ name: 'Otto collection (ZIP)', extensions: ['zip'] }] });
    }

    saveCollectionArchive(defaultName: string): Promise<string | null> {
        return this.savePath('Export Collection', defaultName, 'Otto collection (ZIP)');
    }

    chooseBaseDirectory(defaultPath?: string): Promise<string | null> {
        return this.pickPath({ title: 'Choose the base folder for workspaces', buttonLabel: 'Choose', properties: ['openDirectory', 'createDirectory'], ...(defaultPath && { defaultPath }) });
    }

    /** Arquivo qualquer (corpo File/Binary ou campo de arquivo do multipart). */
    pickFile(title: string): Promise<string | null> {
        return this.pickPath({ title, buttonLabel: 'Select', properties: ['openFile'] });
    }

    pickCertificateFile(): Promise<string | null> {
        return this.pickPath({
            title: 'Select CA Certificate',
            buttonLabel: 'Select',
            properties: ['openFile'],
            filters: [
                { name: 'Certificates', extensions: ['pem', 'crt', 'cer'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });
    }

    pickWorkspaceArchive(): Promise<string | null> {
        return this.pickPath({ title: 'Import Workspace', buttonLabel: 'Import', properties: ['openFile'], filters: [{ name: 'Otto workspace (ZIP)', extensions: ['zip'] }] });
    }

    saveWorkspaceArchive(defaultName: string): Promise<string | null> {
        return this.savePath('Export Workspace', defaultName, 'Otto workspace (ZIP)');
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

    private async pickPath(options: Electron.OpenDialogOptions): Promise<string | null> {
        const win = this.parent();
        const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);

        return result.canceled ? null : (result.filePaths[0] ?? null);
    }

    /** Salvar como .zip (acrescenta a extensão se o usuário não digitar). */
    private async savePath(title: string, defaultName: string, filterName: string): Promise<string | null> {
        const options: Electron.SaveDialogOptions = { title, buttonLabel: 'Export', defaultPath: defaultName, filters: [{ name: filterName, extensions: ['zip'] }] };
        const win = this.parent();
        const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);

        if (result.canceled || !result.filePath) {
            return null;
        }

        return result.filePath.toLowerCase().endsWith('.zip') ? result.filePath : `${result.filePath}.zip`;
    }
}
