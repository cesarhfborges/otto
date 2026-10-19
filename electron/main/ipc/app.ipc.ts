import { app } from 'electron';
import { APP_NAME, defaultBaseDirectory } from '../config';
import type { IIpcModule, IIpcRegistrar } from '../core/contracts';
import { parseCollectionPath, parseEntryName } from '../core/validation';
import type { DialogService } from '../ui/dialogs';

export class AppIpcModule implements IIpcModule {
    constructor(private readonly dialogs: DialogService) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('app:info', () => ({
            name: APP_NAME,
            version: app.getVersion(),
            platform: process.platform,
            versions: {
                electron: process.versions.electron,
                chrome: process.versions.chrome,
                node: process.versions.node
            },
            defaultBaseDirectory: defaultBaseDirectory()
        }));

        ipc.handle('dialog:pick-certificate', () => this.dialogs.pickCertificateFile());

        ipc.handle('dialog:pick-file', (_event, title) => this.dialogs.pickFile(typeof title === 'string' && title.length <= 200 ? title : 'Select File'));

        ipc.handle('dialog:pick-collection-folder', () => this.dialogs.pickCollectionFolder());

        ipc.handle('dialog:pick-collection-archive', () => this.dialogs.pickCollectionArchive());

        ipc.handle('dialog:save-collection-archive', (_event, defaultName) => this.dialogs.saveCollectionArchive(parseEntryName(defaultName)));

        ipc.handle('dialog:pick-workspace-archive', () => this.dialogs.pickWorkspaceArchive());

        ipc.handle('dialog:save-workspace-archive', (_event, defaultName) => this.dialogs.saveWorkspaceArchive(parseEntryName(defaultName)));

        ipc.handle('dialog:choose-base-directory', (_event, current) => this.dialogs.chooseBaseDirectory(typeof current === 'string' && current ? parseCollectionPath(current, 'current') : undefined));
    }
}
