/*
 * Ports do renderer (DIP): componentes e serviços dependem destas classes
 * abstratas, usadas como tokens de DI. As implementações concretas (adapters)
 * são registradas em `provideOttoCore()`.
 */
import type { AppApi, CollectionFilesApi, CollectionsApi, DialogApi, EnvironmentsApi, EventsApi, HistoryApi, HttpApi, KeybindingsApi, SettingsApi, TabsApi, ThemeApi, WindowApi, WorkspacesApi, OpenApiApi, UpdatesApi } from '@shared/api';
import type {
    AppInfo,
    CollectionExportFormat,
    CollectionImportRequest,
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
    UpdateState
} from '@shared/models';

export abstract class AppInfoGateway implements AppApi {
    abstract info(): Promise<AppInfo>;
    abstract relaunch(): Promise<void>;
    abstract confirmQuit(): Promise<void>;
    abstract onQuitRequested(listener: () => void): () => void;
}

export abstract class WindowGateway implements WindowApi {
    abstract state(): Promise<WindowState>;
    abstract minimize(): Promise<void>;
    abstract toggleMaximize(): Promise<void>;
    abstract close(): Promise<void>;
    abstract showAppMenu(x: number, y: number): Promise<void>;
    abstract onStateChanged(listener: (state: WindowState) => void): () => void;
}

export abstract class SettingsGateway implements SettingsApi {
    abstract get(): Promise<OttoSettings>;
    abstract set(patch: SettingsPatch): Promise<OttoSettings>;
    abstract onChanged(listener: (settings: OttoSettings) => void): () => void;
}

export abstract class ThemeGateway implements ThemeApi {
    abstract get(): Promise<ThemeState>;
    abstract onChanged(listener: (state: ThemeState) => void): () => void;
}

export abstract class KeybindingsGateway implements KeybindingsApi {
    abstract get(): Promise<KeybindingOverrides>;
    abstract set(overrides: KeybindingOverrides): Promise<KeybindingOverrides>;
    abstract reset(id?: CommandId): Promise<KeybindingOverrides>;
    abstract onChanged(listener: (overrides: KeybindingOverrides) => void): () => void;
}

export abstract class HttpGateway implements HttpApi {
    abstract send(request: HttpRequest): Promise<HttpResult>;
    abstract cancel(id: string): Promise<boolean>;
}

export abstract class DialogGateway implements DialogApi {
    abstract pickCertificate(): Promise<string | null>;
    abstract pickFile(title: string): Promise<string | null>;
    abstract pickOpenApiFile(): Promise<string | null>;
    abstract pickCollectionArchive(): Promise<string | null>;
    abstract saveCollectionArchive(defaultName: string): Promise<string | null>;
    abstract saveOpenApiSpec(defaultName: string): Promise<string | null>;
    abstract pickWorkspaceArchive(): Promise<string | null>;
    abstract saveWorkspaceArchive(defaultName: string): Promise<string | null>;
    abstract chooseBaseDirectory(current?: string): Promise<string | null>;
}

export abstract class MenuEventsGateway implements EventsApi {
    abstract onMenuAction(listener: (action: MenuAction) => void): () => void;
}

export abstract class HistoryGateway implements HistoryApi {
    abstract list(query?: HistoryQuery): Promise<HistoryEntry[]>;
    abstract delete(id: EntityId): Promise<boolean>;
    abstract clear(): Promise<number>;
    abstract onChanged(listener: () => void): () => void;
}

export abstract class TabsGateway implements TabsApi {
    abstract list(workspaceId: EntityId): Promise<TabState[]>;
    abstract save(workspaceId: EntityId, tabs: TabState[]): Promise<void>;
}

export abstract class WorkspacesGateway implements WorkspacesApi {
    abstract list(): Promise<WorkspaceSummary[]>;
    abstract load(): Promise<LoadedWorkspace>;
    abstract switch(id: EntityId): Promise<Workspace>;
    abstract create(name: string): Promise<Workspace>;
    abstract rename(id: EntityId, name: string): Promise<Workspace>;
    abstract remove(id: EntityId): Promise<void>;
    abstract recreate(id: EntityId): Promise<Workspace>;
    abstract export(id: EntityId, file: string): Promise<void>;
    abstract import(file: string): Promise<Workspace>;
    abstract reveal(id: EntityId): Promise<void>;
    abstract onChanged(listener: () => void): () => void;
}

export abstract class EnvironmentsGateway implements EnvironmentsApi {
    abstract list(collectionId: EntityId | null): Promise<Environment[]>;
    abstract get(id: EntityId): Promise<Environment | null>;
    abstract create(input: NewEnvironment): Promise<Environment>;
    abstract update(id: EntityId, patch: Partial<NewEnvironment>): Promise<Environment | null>;
    abstract delete(id: EntityId): Promise<boolean>;
}

export abstract class CollectionsGateway implements CollectionsApi {
    abstract list(): Promise<CollectionMetadata[]>;
    abstract get(id: EntityId): Promise<CollectionMetadata | null>;
    abstract create(input: NewCollectionMetadata): Promise<CollectionMetadata>;
    abstract update(id: EntityId, patch: Partial<NewCollectionMetadata>): Promise<CollectionMetadata | null>;
    abstract delete(id: EntityId): Promise<boolean>;
    abstract createOnDisk(name: string): Promise<OpenedCollection>;
    abstract import(request: CollectionImportRequest): Promise<OpenedCollection>;
    abstract export(id: EntityId, format: CollectionExportFormat, file: string): Promise<void>;
    abstract close(id: EntityId): Promise<void>;
    abstract trash(id: EntityId): Promise<void>;
    abstract tree(id: EntityId): Promise<CollectionTree>;
    abstract manifest(id: EntityId): Promise<CollectionManifest>;
    abstract updateManifest(id: EntityId, patch: CollectionManifestPatch): Promise<CollectionManifest>;
    abstract onChanged(listener: (event: { collectionId: EntityId }) => void): () => void;
}

export abstract class CollectionFilesGateway implements CollectionFilesApi {
    abstract readRequest(collectionId: EntityId, path: string): Promise<RequestDefinition>;
    abstract saveRequest(collectionId: EntityId, path: string, request: RequestDefinition): Promise<void>;
    abstract createRequest(collectionId: EntityId, folder: string, request: RequestDefinition): Promise<string>;
    abstract createFolder(collectionId: EntityId, parent: string, name: string): Promise<string>;
    abstract move(collectionId: EntityId, from: string, to: string): Promise<void>;
    abstract duplicate(collectionId: EntityId, path: string, name: string): Promise<string>;
    abstract rename(collectionId: EntityId, path: string, name: string): Promise<string>;
    abstract reorder(collectionId: EntityId, entries: string[]): Promise<void>;
    abstract remove(collectionId: EntityId, path: string): Promise<void>;
    abstract reveal(collectionId: EntityId, path: string): Promise<void>;
}

export abstract class OpenApiGateway implements OpenApiApi {
    abstract status(collectionId: EntityId, refresh?: boolean): Promise<OpenApiStatus>;
    abstract connect(collectionId: EntityId, config: OpenApiConfig): Promise<OpenApiStatus>;
    abstract disconnect(collectionId: EntityId): Promise<void>;
    abstract spec(collectionId: EntityId): Promise<string>;
    abstract sync(collectionId: EntityId, keys: string[]): Promise<OpenApiStatus>;
    abstract revert(collectionId: EntityId, keys: string[]): Promise<OpenApiStatus>;
}

export abstract class UpdatesGateway implements UpdatesApi {
    abstract state(): Promise<UpdateState>;
    abstract check(): Promise<UpdateState>;
    abstract download(): Promise<void>;
    abstract install(): Promise<void>;
    abstract skip(version: string): Promise<void>;
    abstract remindLater(): Promise<void>;
    abstract clearSkipped(): Promise<void>;
    abstract openRelease(): Promise<void>;
    abstract onStateChanged(listener: (state: UpdateState) => void): () => void;
    abstract onOpenRequested(listener: () => void): () => void;
}
