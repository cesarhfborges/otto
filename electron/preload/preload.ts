import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { OttoApi } from '../shared/api';
import type { IpcArgs, IpcEventChannel, IpcEventContract, IpcInvokeChannel, IpcResult } from '../shared/ipc';

/* O tsconfig do Electron não inclui a lib DOM (para não vazar globais no main): declaramos só o necessário. */
declare const window: { addEventListener(type: 'DOMContentLoaded', listener: () => void, options?: { once?: boolean }): void };
declare const document: { documentElement: { classList: { add(token: string): void } } };

/*
 * O preload roda em sandbox: só `electron` pode ser importado em tempo de execução.
 * Todo import local aqui DEVE ser `import type` (apagado na compilação).
 */

const invoke = <C extends IpcInvokeChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> => ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<C>>;

const subscribe = <C extends IpcEventChannel>(channel: C, listener: (payload: IpcEventContract[C]) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: IpcEventContract[C]) => listener(payload);

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
        set: (patch) => invoke('settings:set', patch),
        onChanged: (listener) => subscribe('settings:changed', listener)
    },
    theme: {
        get: () => invoke('theme:get'),
        onChanged: (listener) => subscribe('theme:changed', listener)
    },
    http: {
        send: (request) => invoke('http:send', request),
        cancel: (id) => invoke('http:cancel', id)
    },
    dialog: {
        openCollection: () => invoke('dialog:open-collection'),
        pickCertificate: () => invoke('dialog:pick-certificate')
    },
    history: {
        list: (query) => invoke('history:list', query),
        delete: (id) => invoke('history:delete', id),
        clear: () => invoke('history:clear')
    },
    tabs: {
        list: () => invoke('tabs:list'),
        save: (tabs) => invoke('tabs:save', tabs)
    },
    environments: {
        list: (collectionId) => invoke('environments:list', collectionId),
        get: (id) => invoke('environments:get', id),
        create: (input) => invoke('environments:create', input),
        update: (id, patch) => invoke('environments:update', id, patch),
        delete: (id) => invoke('environments:delete', id)
    },
    collections: {
        list: () => invoke('collections:list'),
        get: (id) => invoke('collections:get', id),
        create: (input) => invoke('collections:create', input),
        update: (id, patch) => invoke('collections:update', id, patch),
        delete: (id) => invoke('collections:delete', id)
    },
    onMenuAction: (listener) => subscribe('menu:action', listener)
};

contextBridge.exposeInMainWorld('otto', api);

// Pinta já no tema escuro (classe usada pelo PrimeNG/Sakai); o ThemeService assume depois.
if (process.argv.includes('--otto-dark=1')) {
    window.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('app-dark'), { once: true });
}
