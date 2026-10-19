import { app } from 'electron';
import { APP_NAME } from '../config';
import { pickCollectionFolder } from '../dialogs';
import { settings } from '../settings';
import type { AppInfo, OttoSettings } from '../shared/contract';
import { handle } from './handle';

export function registerAppIpc(): void {
    handle(
        'app:info',
        (): AppInfo => ({
            name: APP_NAME,
            version: app.getVersion(),
            platform: process.platform,
            versions: {
                electron: process.versions.electron,
                chrome: process.versions.chrome,
                node: process.versions.node
            }
        })
    );

    handle('settings:get', () => settings.getPublic());

    handle('settings:set', (_event, patch) => settings.setPublic((patch ?? {}) as Partial<OttoSettings>));

    handle('dialog:open-collection', () => pickCollectionFolder());
}
