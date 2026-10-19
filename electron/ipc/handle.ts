import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { isDev, rendererUrl } from '../config';
import type { IpcInvokeChannel } from '../shared/contract';

/** Aceita IPC apenas de frames do próprio app (dev server ou arquivos locais empacotados). */
const isTrustedSender = (event: IpcMainInvokeEvent): boolean => {
    const url = event.senderFrame?.url ?? '';

    return isDev ? url.startsWith(rendererUrl) : url.startsWith('file://');
};

export function handle(channel: IpcInvokeChannel, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
    ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedSender(event)) {
            throw new Error(`Untrusted IPC sender for "${channel}"`);
        }

        return listener(event, ...args);
    });
}
