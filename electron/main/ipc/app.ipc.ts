import { app } from 'electron';
import { APP_NAME } from '../config';
import type { IIpcModule, IIpcRegistrar } from '../core/contracts';
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
            }
        }));

        ipc.handle('dialog:open-collection', () => this.dialogs.pickCollectionFolder());

        ipc.handle('dialog:pick-certificate', () => this.dialogs.pickCertificateFile());

        ipc.handle('dialog:choose-collection-location', () => this.dialogs.chooseCollectionLocation());
    }
}
