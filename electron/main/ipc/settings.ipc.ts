import type { IIpcModule, IIpcRegistrar, IRendererNotifier, ISettingsService } from '../core/contracts';
import { parseSettingsPatch } from '../core/validation';

export class SettingsIpcModule implements IIpcModule {
    constructor(
        private readonly settings: ISettingsService,
        private readonly notifier: IRendererNotifier
    ) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('settings:get', () => this.settings.get());

        ipc.handle('settings:set', (_event, patch) => this.settings.update(parseSettingsPatch(patch)));

        // Mudanças vindas de qualquer origem (renderer, tray) são refletidas na UI.
        this.settings.onChange((settings) => this.notifier.notify('settings:changed', settings));
    }
}
