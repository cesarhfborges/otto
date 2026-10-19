import type { IIpcModule, IIpcRegistrar } from '../core/contracts';
import { requireInteger } from '../core/validation';
import type { WindowManager } from '../ui/window';

/** Controles da janela usados pela barra de título própria do renderer. */
export class WindowIpcModule implements IIpcModule {
    constructor(private readonly window: WindowManager) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('window:get-state', () => this.window.state());

        ipc.handle('window:minimize', () => this.window.minimize());

        ipc.handle('window:toggle-maximize', () => this.window.toggleMaximize());

        ipc.handle('window:close', () => this.window.close());

        ipc.handle('window:show-app-menu', (_event, x, y) => this.window.showAppMenu(requireInteger(x, 'x', 0), requireInteger(y, 'y', 0)));
    }
}
