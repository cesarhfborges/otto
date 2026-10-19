/*
 * Ports do renderer (DIP): componentes e serviços dependem destas classes
 * abstratas, usadas como tokens de DI. As implementações concretas (adapters)
 * são registradas em `provideOttoCore()`.
 */
import type { AppApi, CollectionFilesApi, CollectionsApi, DialogApi, EnvironmentsApi, EventsApi, HistoryApi, HttpApi, SettingsApi, TabsApi, ThemeApi, WindowApi } from '@shared/api';
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
} from '@shared/models';

export abstract class AppInfoGateway implements AppApi {
    abstract info(): Promise<AppInfo>;
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

export abstract class HttpGateway implements HttpApi {
    abstract send(request: HttpRequest): Promise<HttpResult>;
    abstract cancel(id: string): Promise<boolean>;
}

export abstract class DialogGateway implements DialogApi {
    abstract openCollection(): Promise<string | null>;
    abstract pickCertificate(): Promise<string | null>;
    abstract chooseCollectionLocation(): Promise<string | null>;
}

export abstract class MenuEventsGateway implements EventsApi {
    abstract onMenuAction(listener: (action: MenuAction) => void): () => void;
}

export abstract class HistoryGateway implements HistoryApi {
    abstract list(query?: HistoryQuery): Promise<HistoryEntry[]>;
    abstract delete(id: EntityId): Promise<boolean>;
    abstract clear(): Promise<number>;
}

export abstract class TabsGateway implements TabsApi {
    abstract list(): Promise<TabState[]>;
    abstract save(tabs: TabState[]): Promise<void>;
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
    abstract open(directory: string): Promise<OpenedCollection>;
    abstract createOnDisk(parentDirectory: string, name: string): Promise<OpenedCollection>;
    abstract close(id: EntityId): Promise<void>;
    abstract tree(id: EntityId): Promise<CollectionTree>;
    abstract onChanged(listener: (event: { collectionId: EntityId }) => void): () => void;
}

export abstract class CollectionFilesGateway implements CollectionFilesApi {
    abstract readRequest(collectionId: EntityId, path: string): Promise<RequestDefinition>;
    abstract saveRequest(collectionId: EntityId, path: string, request: RequestDefinition): Promise<void>;
    abstract createRequest(collectionId: EntityId, folder: string, request: RequestDefinition): Promise<string>;
    abstract createFolder(collectionId: EntityId, parent: string, name: string): Promise<string>;
    abstract move(collectionId: EntityId, from: string, to: string): Promise<void>;
    abstract remove(collectionId: EntityId, path: string): Promise<void>;
}
