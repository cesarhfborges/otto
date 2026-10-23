import type { IIpcModule, IIpcRegistrar } from '../core/contracts';
import { requireString } from '../core/validation/guards';
import type { UpdateService } from '../services/updates/update.service';
import type { WindowManager } from '../ui/window';

export class UpdatesIpcModule implements IIpcModule {
    constructor(
        private readonly updates: UpdateService,
        private readonly window: WindowManager
    ) {}

    register(ipc: IIpcRegistrar): void {
        this.updates.onChange((state) => this.window.notify('updates:state-changed', state));

        ipc.handle('updates:state', () => this.updates.current);
        ipc.handle('updates:check', () => this.updates.check());
        ipc.handle('updates:download', () => this.updates.download());
        ipc.handle('updates:install', () => this.updates.install());
        ipc.handle('updates:skip', (_event, version) => this.updates.skip(requireString(version, 'version', { maxLength: 100 })));
        ipc.handle('updates:remind-later', () => this.updates.remindLater());
        ipc.handle('updates:clear-skipped', () => this.updates.clearSkipped());
        ipc.handle('updates:open-release', () => this.updates.openReleasePage());
    }
}
