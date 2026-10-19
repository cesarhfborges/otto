import type { IIpcModule, IIpcRegistrar } from '../core/contracts';
import type { ThemeController } from '../ui/theme';

export class ThemeIpcModule implements IIpcModule {
    constructor(private readonly theme: ThemeController) {}

    register(ipc: IIpcRegistrar): void {
        ipc.handle('theme:get', () => this.theme.state());
    }
}
