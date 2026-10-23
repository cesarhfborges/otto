/**
 * Contrato de IPC compartilhado entre o processo main, o preload e o Angular.
 *
 * Cada canal declara os argumentos e o resultado, de modo que `invoke` (preload)
 * e `handle` (main) sejam verificados pelo compilador. O preload roda em sandbox
 * e só pode importar *tipos* deste arquivo (`import type`).
 */
import type {
    CollectionExportFormat,
    CollectionImportRequest,
    AppInfo,
    CollectionMetadata,
    CollectionTree,
    OpenedCollection,
    RequestDefinition,
    EntityId,
    Environment,
    HistoryEntry,
    HistoryEntryWithDetail,
    HistoryQuery,
    HttpRequest,
    HttpResult,
    CommandId,
    KeybindingOverrides,
    MenuAction,
    NewCollectionMetadata,
    NewEnvironment,
    OttoSettings,
    SettingsPatch,
    TabState,
    ThemeState,
    WindowState,
    LoadedWorkspace,
    Workspace,
    WorkspaceSummary,
    CollectionManifest,
    CollectionManifestPatch,
    OpenApiConfig,
    OpenApiStatus,
    UpdateState,
    MockServerStatus
} from './models';

export interface IpcInvokeContract {
    'app:info': { args: []; result: AppInfo };
    'app:relaunch': { args: []; result: void };
    /** O renderer liberou a saída pedida em `app:quit-requested` (sem alterações pendentes ou descartadas). */
    'app:confirm-quit': { args: []; result: void };
    'window:get-state': { args: []; result: WindowState };
    'window:minimize': { args: []; result: void };
    'window:toggle-maximize': { args: []; result: void };
    'window:close': { args: []; result: void };
    'window:show-app-menu': { args: [x: number, y: number]; result: void };
    'settings:get': { args: []; result: OttoSettings };
    'settings:set': { args: [patch: SettingsPatch]; result: OttoSettings };
    'theme:get': { args: []; result: ThemeState };
    'keybindings:get': { args: []; result: KeybindingOverrides };
    'keybindings:set': { args: [overrides: KeybindingOverrides]; result: KeybindingOverrides };
    'keybindings:reset': { args: [id?: CommandId]; result: KeybindingOverrides };
    'http:send': { args: [request: HttpRequest]; result: HttpResult };
    'http:cancel': { args: [id: string]; result: boolean };
    'dialog:pick-certificate': { args: []; result: string | null };
    'dialog:pick-file': { args: [title: string]; result: string | null };
    'dialog:pick-openapi-file': { args: []; result: string | null };
    'dialog:pick-collection-archive': { args: []; result: string | null };
    'dialog:save-collection-archive': { args: [defaultName: string]; result: string | null };
    'dialog:save-openapi-spec': { args: [defaultName: string]; result: string | null };
    'dialog:pick-workspace-archive': { args: []; result: string | null };
    'dialog:save-workspace-archive': { args: [defaultName: string]; result: string | null };
    'dialog:choose-base-directory': { args: [current?: string]; result: string | null };
    'history:list': { args: [query?: HistoryQuery]; result: HistoryEntry[] };
    'history:get': { args: [id: EntityId]; result: HistoryEntryWithDetail | null };
    'history:delete': { args: [id: EntityId]; result: boolean };
    'history:clear': { args: []; result: number };
    'tabs:list': { args: [workspaceId: EntityId]; result: TabState[] };
    'tabs:save': { args: [workspaceId: EntityId, tabs: TabState[]]; result: void };
    'workspaces:list': { args: []; result: WorkspaceSummary[] };
    'workspaces:load': { args: []; result: LoadedWorkspace };
    'workspaces:switch': { args: [id: EntityId]; result: Workspace };
    'workspaces:create': { args: [name: string]; result: Workspace };
    'workspaces:rename': { args: [id: EntityId, name: string]; result: Workspace };
    'workspaces:remove': { args: [id: EntityId]; result: void };
    'workspaces:recreate': { args: [id: EntityId]; result: Workspace };
    'workspaces:export': { args: [id: EntityId, file: string]; result: void };
    'workspaces:import': { args: [file: string]; result: Workspace };
    'workspaces:reveal': { args: [id: EntityId]; result: void };
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
    'collections:new': { args: [name: string]; result: OpenedCollection };
    'collections:import': { args: [request: CollectionImportRequest]; result: OpenedCollection };
    'collections:export': { args: [id: EntityId, format: CollectionExportFormat, file: string]; result: void };
    'collections:close': { args: [id: EntityId]; result: void };
    'collections:trash': { args: [id: EntityId]; result: void };
    'collections:tree': { args: [id: EntityId]; result: CollectionTree };
    'collections:manifest': { args: [id: EntityId]; result: CollectionManifest };
    'collections:update-manifest': { args: [id: EntityId, patch: CollectionManifestPatch]; result: CollectionManifest };
    'openapi:status': { args: [collectionId: EntityId, refresh?: boolean]; result: OpenApiStatus };
    'openapi:connect': { args: [collectionId: EntityId, config: OpenApiConfig]; result: OpenApiStatus };
    'openapi:disconnect': { args: [collectionId: EntityId]; result: void };
    'openapi:spec': { args: [collectionId: EntityId]; result: string };
    'openapi:sync': { args: [collectionId: EntityId, keys: string[]]; result: OpenApiStatus };
    'openapi:revert': { args: [collectionId: EntityId, keys: string[]]; result: OpenApiStatus };
    'collection-files:read-request': { args: [collectionId: EntityId, path: string]; result: RequestDefinition };
    'collection-files:save-request': { args: [collectionId: EntityId, path: string, request: RequestDefinition]; result: void };
    'collection-files:create-request': { args: [collectionId: EntityId, folder: string, request: RequestDefinition]; result: string };
    'collection-files:create-folder': { args: [collectionId: EntityId, parent: string, name: string]; result: string };
    'collection-files:move': { args: [collectionId: EntityId, from: string, to: string]; result: void };
    'collection-files:duplicate': { args: [collectionId: EntityId, path: string, name: string]; result: string };
    'collection-files:rename': { args: [collectionId: EntityId, path: string, name: string]; result: string };
    'collection-files:reorder': { args: [collectionId: EntityId, entries: string[]]; result: void };
    'collection-files:remove': { args: [collectionId: EntityId, path: string]; result: void };
    'collection-files:reveal': { args: [collectionId: EntityId, path: string]; result: void };
    'mock:list': { args: []; result: MockServerStatus[] };
    'mock:start': { args: [collectionId: EntityId, port: number]; result: MockServerStatus };
    'mock:stop': { args: [collectionId: EntityId]; result: void };
    'updates:state': { args: []; result: UpdateState };
    'updates:check': { args: []; result: UpdateState };
    'updates:download': { args: []; result: void };
    'updates:install': { args: []; result: void };
    'updates:skip': { args: [version: string]; result: void };
    'updates:remind-later': { args: []; result: void };
    'updates:clear-skipped': { args: []; result: void };
    'updates:open-release': { args: []; result: void };
}

/** Canais acessados via `ipcRenderer.invoke` / `ipcMain.handle`. */
export type IpcInvokeChannel = keyof IpcInvokeContract;

export type IpcArgs<C extends IpcInvokeChannel> = IpcInvokeContract[C]['args'];

export type IpcResult<C extends IpcInvokeChannel> = IpcInvokeContract[C]['result'];

/** Eventos enviados do main para o renderer (`webContents.send`). */
export interface IpcEventContract {
    'menu:action': MenuAction;
    /** Saída real do app (Quit, Ctrl+Q, tray ou fechar sem bandeja): o renderer confirma alterações pendentes. */
    'app:quit-requested': null;
    'window:state-changed': WindowState;
    'settings:changed': OttoSettings;
    'theme:changed': ThemeState;
    /** Atalhos personalizados mudaram (Preferences → Keyboard Shortcuts). */
    'keybindings:changed': KeybindingOverrides;
    /** Conteúdo da coleção mudou no disco (pelo app ou externamente). */
    'collections:changed': { collectionId: EntityId };
    /** Uma execução foi registrada no histórico (ou registros antigos foram apagados). */
    'history:changed': null;
    /** Lista de workspaces, ativo ou coleções de um workspace mudaram. */
    'workspaces:changed': null;
    'updates:state-changed': UpdateState;
    /** Um mock server iniciou, parou ou recebeu uma chamada. */
    'mock:changed': MockServerStatus[];
    /** "Check for Updates…" no menu ou na bandeja: o renderer abre a janela de atualização. */
    'updates:open-dialog': null;
}

export type IpcEventChannel = keyof IpcEventContract;
