import { app, dialog, type BrowserWindow } from 'electron';
import { APP_NAME, assetPath, REPOSITORY_URL } from '../config';

/** Diálogos nativos, ancorados na janela principal quando ela existe. */
export class DialogService {
    constructor(private readonly parent: () => BrowserWindow | null) {}

    /** Spec OpenAPI/Swagger local a importar como coleção. */
    pickOpenApiFile(): Promise<string | null> {
        return this.pickPath({
            title: 'Import OpenAPI Spec',
            buttonLabel: 'Import',
            properties: ['openFile'],
            filters: [
                { name: 'OpenAPI / Swagger (JSON, YAML)', extensions: ['json', 'yaml', 'yml'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });
    }

    pickCollectionArchive(): Promise<string | null> {
        return this.pickPath({ title: 'Import Otto Backup', buttonLabel: 'Import', properties: ['openFile'], filters: [{ name: 'Otto backup (ZIP)', extensions: ['zip'] }] });
    }

    saveCollectionArchive(defaultName: string): Promise<string | null> {
        return this.savePath('Export Collection Backup', defaultName, 'Otto backup (ZIP)');
    }

    /** Salvar o spec OpenAPI; sem extensão conhecida, grava como .yaml. */
    async saveOpenApiSpec(defaultName: string): Promise<string | null> {
        const options: Electron.SaveDialogOptions = {
            title: 'Export OpenAPI Spec',
            buttonLabel: 'Export',
            defaultPath: defaultName,
            filters: [
                { name: 'OpenAPI (YAML)', extensions: ['yaml', 'yml'] },
                { name: 'OpenAPI (JSON)', extensions: ['json'] }
            ]
        };
        const win = this.parent();
        const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);

        if (result.canceled || !result.filePath) {
            return null;
        }

        return /\.(ya?ml|json)$/i.test(result.filePath) ? result.filePath : `${result.filePath}.yaml`;
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
