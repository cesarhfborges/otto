import type { IIpcModule, IIpcRegistrar, IKeybindingService, IRendererNotifier } from '../core/contracts';
import { parseCommandId, parseKeybindingOverrides } from '../core/validation';

/** Atalhos personalizados (Preferences → Keyboard Shortcuts). */
export class KeybindingsIpcModule implements IIpcModule {
    constructor(
        private readonly keybindings: IKeybindingService,
        private readonly notifier: IRendererNotifier,
        private readonly mac: boolean
    ) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('keybindings:get', () => this.keybindings.get());

        ipc.handle('keybindings:set', (_event, overrides) => this.keybindings.set(parseKeybindingOverrides(overrides, this.mac, true)));

        ipc.handle('keybindings:reset', (_event, id) => this.keybindings.reset(id === undefined || id === null ? undefined : parseCommandId(id)));

        this.keybindings.onChange((overrides) => this.notifier.notify('keybindings:changed', overrides));
    }
}
