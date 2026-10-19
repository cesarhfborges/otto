import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { IpcEventChannel, IpcInvokeChannel, MenuAction, OttoApi } from './shared/contract';

const invoke = <T>(channel: IpcInvokeChannel, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

const subscribe = <T>(channel: IpcEventChannel, listener: (payload: T) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: T) => listener(payload);

    ipcRenderer.on(channel, wrapped);

    return () => ipcRenderer.removeListener(channel, wrapped);
};

const api: OttoApi = {
    isElectron: true,
    platform: process.platform,
    app: {
        info: () => invoke('app:info')
    },
    settings: {
        get: () => invoke('settings:get'),
        set: (patch) => invoke('settings:set', patch)
    },
    http: {
        send: (request) => invoke('http:send', request),
        cancel: (id) => invoke('http:cancel', id)
    },
    dialog: {
        openCollection: () => invoke('dialog:open-collection')
    },
    onMenuAction: (listener) => subscribe<MenuAction>('menu:action', listener)
};

contextBridge.exposeInMainWorld('otto', api);
