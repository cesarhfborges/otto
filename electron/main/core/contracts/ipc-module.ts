import type { IpcMainInvokeEvent } from 'electron';
import type { IpcInvokeChannel, IpcResult } from '../../../shared/ipc';

/**
 * Handler de um canal IPC. Os argumentos chegam como `unknown` porque vêm do
 * renderer e precisam ser validados; o resultado é verificado pelo contrato.
 */
export type IpcHandler<C extends IpcInvokeChannel> = (event: IpcMainInvokeEvent, ...args: unknown[]) => IpcResult<C> | Promise<IpcResult<C>>;

export interface IIpcRegistrar {
    handle<C extends IpcInvokeChannel>(channel: C, handler: IpcHandler<C>): void;
}

/** Agrupa os canais IPC de uma responsabilidade (app, http, settings...). */
export interface IIpcModule {
    register(ipc: IIpcRegistrar): void;
}
