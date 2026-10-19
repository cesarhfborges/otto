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
    window: {
        state: () => invoke('window:get-state'),
        minimize: () => invoke('window:minimize'),
        toggleMaximize: () => invoke('window:toggle-maximize'),
        close: () => invoke('window:close'),
        showAppMenu: (x, y) => invoke('window:show-app-menu', x, y),
        onStateChanged: (listener) => subscribe('window:state-changed', listener)
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
        pickCertificate: () => invoke('dialog:pick-certificate'),
        pickCollectionFolder: () => invoke('dialog:pick-collection-folder'),
        pickCollectionArchive: () => invoke('dialog:pick-collection-archive'),
        saveCollectionArchive: (defaultName) => invoke('dialog:save-collection-archive', defaultName),
        pickWorkspaceArchive: () => invoke('dialog:pick-workspace-archive'),
        saveWorkspaceArchive: (defaultName) => invoke('dialog:save-workspace-archive', defaultName),
        chooseBaseDirectory: (current) => invoke('dialog:choose-base-directory', current)
    },
    history: {
        list: (query) => invoke('history:list', query),
        delete: (id) => invoke('history:delete', id),
        clear: () => invoke('history:clear'),
        onChanged: (listener) => subscribe('history:changed', () => listener())
    },
    tabs: {
        list: (workspaceId) => invoke('tabs:list', workspaceId),
        save: (workspaceId, tabs) => invoke('tabs:save', workspaceId, tabs)
    },
    workspaces: {
        list: () => invoke('workspaces:list'),
        load: () => invoke('workspaces:load'),
        switch: (id) => invoke('workspaces:switch', id),
        create: (name) => invoke('workspaces:create', name),
        rename: (id, name) => invoke('workspaces:rename', id, name),
        remove: (id) => invoke('workspaces:remove', id),
        export: (id, file) => invoke('workspaces:export', id, file),
        import: (file) => invoke('workspaces:import', file),
        reveal: (id) => invoke('workspaces:reveal', id),
        onChanged: (listener) => subscribe('workspaces:changed', () => listener())
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
        delete: (id) => invoke('collections:delete', id),
        createOnDisk: (name) => invoke('collections:new', name),
        import: (source) => invoke('collections:import', source),
        export: (id, file) => invoke('collections:export', id, file),
        close: (id) => invoke('collections:close', id),
        tree: (id) => invoke('collections:tree', id),
        onChanged: (listener) => subscribe('collections:changed', listener)
    },
    collectionFiles: {
        readRequest: (collectionId, path) => invoke('collection-files:read-request', collectionId, path),
        saveRequest: (collectionId, path, request) => invoke('collection-files:save-request', collectionId, path, request),
        createRequest: (collectionId, folder, request) => invoke('collection-files:create-request', collectionId, folder, request),
        createFolder: (collectionId, parent, name) => invoke('collection-files:create-folder', collectionId, parent, name),
        move: (collectionId, from, to) => invoke('collection-files:move', collectionId, from, to),
        remove: (collectionId, path) => invoke('collection-files:remove', collectionId, path)
    },
    onMenuAction: (listener) => subscribe('menu:action', listener)
};

contextBridge.exposeInMainWorld('otto', api);

// Pinta já no tema escuro (classe usada pelo PrimeNG/Sakai); o ThemeService assume depois.
if (process.argv.includes('--otto-dark=1')) {
    window.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('app-dark'), { once: true });
}
