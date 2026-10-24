import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { IpcInvokeChannel } from '../../shared/ipc';
import { isDev, rendererUrl } from '../config';
import type { IIpcRegistrar, IpcHandler } from '../core/contracts';

/** Aceita IPC apenas de frames do próprio app (dev server ou arquivos locais empacotados). */
const isTrustedSender = (event: IpcMainInvokeEvent): boolean => {
    const url = event.senderFrame?.url ?? '';

    return isDev ? url.startsWith(rendererUrl) : url.startsWith('file://');
};

/** Registrador sobre o `ipcMain` que rejeita chamadas de origens não confiáveis. */
export class ElectronIpcRegistrar implements IIpcRegistrar {
    handle<C extends IpcInvokeChannel>(channel: C, handler: IpcHandler<C>): void {
        ipcMain.handle(channel, (event, ...args) => {
            if (!isTrustedSender(event)) {
                throw new Error(`Untrusted IPC sender for "${channel}"`);
            }

            return handler(event, ...args);
        });
    }
}
