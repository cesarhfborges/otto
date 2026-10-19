/**
 * Contrato de IPC compartilhado entre o processo main, o preload e o Angular.
 *
 * Cada canal declara os argumentos e o resultado, de modo que `invoke` (preload)
 * e `handle` (main) sejam verificados pelo compilador. O preload roda em sandbox
 * e só pode importar *tipos* deste arquivo (`import type`).
 */
import type { AppInfo, CollectionMetadata, EntityId, Environment, HistoryEntry, HistoryQuery, HttpRequest, HttpResult, MenuAction, NewCollectionMetadata, NewEnvironment, OttoSettings, SettingsPatch, TabState, ThemeState } from './models';

export interface IpcInvokeContract {
    'app:info': { args: []; result: AppInfo };
    'settings:get': { args: []; result: OttoSettings };
    'settings:set': { args: [patch: SettingsPatch]; result: OttoSettings };
    'theme:get': { args: []; result: ThemeState };
    'http:send': { args: [request: HttpRequest]; result: HttpResult };
    'http:cancel': { args: [id: string]; result: boolean };
    'dialog:open-collection': { args: []; result: string | null };
    'dialog:pick-certificate': { args: []; result: string | null };
    'history:list': { args: [query?: HistoryQuery]; result: HistoryEntry[] };
    'history:delete': { args: [id: EntityId]; result: boolean };
    'history:clear': { args: []; result: number };
    'tabs:list': { args: []; result: TabState[] };
    'tabs:save': { args: [tabs: TabState[]]; result: void };
    'environments:list': { args: [collectionId: EntityId | null]; result: Environment[] };
    'environments:get': { args: [id: EntityId]; result: Environment | null };
    'environments:create': { args: [input: NewEnvironment]; result: Environment };
    'environments:update': { args: [id: EntityId, patch: Partial<NewEnvironment>]; result: Environment | null };
    'environments:delete': { args: [id: EntityId]; result: boolean };
    'collections:list': { args: []; result: CollectionMetadata[] };
    'collections:get': { args: [id: EntityId]; result: CollectionMetadata | null };
    'collections:create': { args: [input: NewCollectionMetadata]; result: CollectionMetadata };
    'collections:update': { args: [id: EntityId, patch: Partial<NewCollectionMetadata>]; result: CollectionMetadata | null };
    'collections:delete': { args: [id: EntityId]; result: boolean };
}

/** Canais acessados via `ipcRenderer.invoke` / `ipcMain.handle`. */
export type IpcInvokeChannel = keyof IpcInvokeContract;

export type IpcArgs<C extends IpcInvokeChannel> = IpcInvokeContract[C]['args'];

export type IpcResult<C extends IpcInvokeChannel> = IpcInvokeContract[C]['result'];

/** Eventos enviados do main para o renderer (`webContents.send`). */
export interface IpcEventContract {
    'menu:action': MenuAction;
    'settings:changed': OttoSettings;
    'theme:changed': ThemeState;
}

export type IpcEventChannel = keyof IpcEventContract;
