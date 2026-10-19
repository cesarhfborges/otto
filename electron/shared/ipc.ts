/**
 * Contrato de IPC compartilhado entre o processo main, o preload e o Angular.
 *
 * Cada canal declara os argumentos e o resultado, de modo que `invoke` (preload)
 * e `handle` (main) sejam verificados pelo compilador. O preload roda em sandbox
 * e só pode importar *tipos* deste arquivo (`import type`).
 */
import type {
    AppInfo,
    CollectionMetadata,
    CollectionTree,
    OpenedCollection,
    RequestDefinition,
    EntityId,
    Environment,
    HistoryEntry,
    HistoryQuery,
    HttpRequest,
    HttpResult,
    MenuAction,
    NewCollectionMetadata,
    NewEnvironment,
    OttoSettings,
    SettingsPatch,
    TabState,
    ThemeState,
    WindowState
} from './models';

export interface IpcInvokeContract {
    'app:info': { args: []; result: AppInfo };
    'window:get-state': { args: []; result: WindowState };
    'window:minimize': { args: []; result: void };
    'window:toggle-maximize': { args: []; result: void };
    'window:close': { args: []; result: void };
    'window:show-app-menu': { args: [x: number, y: number]; result: void };
    'settings:get': { args: []; result: OttoSettings };
    'settings:set': { args: [patch: SettingsPatch]; result: OttoSettings };
    'theme:get': { args: []; result: ThemeState };
    'http:send': { args: [request: HttpRequest]; result: HttpResult };
    'http:cancel': { args: [id: string]; result: boolean };
    'dialog:open-collection': { args: []; result: string | null };
    'dialog:pick-certificate': { args: []; result: string | null };
    'dialog:choose-collection-location': { args: []; result: string | null };
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
    'collections:open': { args: [directory: string]; result: OpenedCollection };
    'collections:new': { args: [parentDirectory: string, name: string]; result: OpenedCollection };
    'collections:close': { args: [id: EntityId]; result: void };
    'collections:tree': { args: [id: EntityId]; result: CollectionTree };
    'collection-files:read-request': { args: [collectionId: EntityId, path: string]; result: RequestDefinition };
    'collection-files:save-request': { args: [collectionId: EntityId, path: string, request: RequestDefinition]; result: void };
    'collection-files:create-request': { args: [collectionId: EntityId, folder: string, request: RequestDefinition]; result: string };
    'collection-files:create-folder': { args: [collectionId: EntityId, parent: string, name: string]; result: string };
    'collection-files:move': { args: [collectionId: EntityId, from: string, to: string]; result: void };
    'collection-files:remove': { args: [collectionId: EntityId, path: string]; result: void };
}

/** Canais acessados via `ipcRenderer.invoke` / `ipcMain.handle`. */
export type IpcInvokeChannel = keyof IpcInvokeContract;

export type IpcArgs<C extends IpcInvokeChannel> = IpcInvokeContract[C]['args'];

export type IpcResult<C extends IpcInvokeChannel> = IpcInvokeContract[C]['result'];

/** Eventos enviados do main para o renderer (`webContents.send`). */
export interface IpcEventContract {
    'menu:action': MenuAction;
    'window:state-changed': WindowState;
    'settings:changed': OttoSettings;
    'theme:changed': ThemeState;
    /** Conteúdo da coleção mudou no disco (pelo app ou externamente). */
    'collections:changed': { collectionId: EntityId };
}

export type IpcEventChannel = keyof IpcEventContract;
