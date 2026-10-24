import { inject, Injectable } from '@angular/core';
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
    MockServerStatus,
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
    WorkspaceMoveResult,
    WorkspaceSummary,
    CollectionManifest,
    CollectionManifestPatch,
    FolderSettings,
    OpenApiConfig,
    OpenApiStatus,
    UpdateState
} from '@shared/models';
import { OTTO_API, requireOttoApi } from '../../bridge/otto-api.token';
import {
    AppInfoGateway,
    CollectionFilesGateway,
    CollectionsGateway,
    DialogGateway,
    EnvironmentsGateway,
    HttpGateway,
    KeybindingsGateway,
    MenuEventsGateway,
    SettingsGateway,
    TabsGateway,
    ThemeGateway,
    WindowGateway,
    WorkspacesGateway,
    OpenApiGateway,
    UpdatesGateway,
    MockGateway
} from '../../ports';

/*
 * Adapters que delegam para `window.otto` (IPC). Fora do Electron, chamadas
 * rejeitam com `BridgeUnavailableError` e eventos simplesmente não disparam.
 */

@Injectable()
export class ElectronAppInfoGateway extends AppInfoGateway {
    private readonly api = inject(OTTO_API);

    info(): Promise<AppInfo> {
        return requireOttoApi(this.api).app.info();
    }

    relaunch(): Promise<void> {
        return requireOttoApi(this.api).app.relaunch();
    }

    confirmQuit(): Promise<void> {
        return requireOttoApi(this.api).app.confirmQuit();
    }

    onQuitRequested(listener: () => void): () => void {
        return this.api?.app.onQuitRequested(listener) ?? (() => undefined);
    }
}

@Injectable()
export class ElectronWindowGateway extends WindowGateway {
    private readonly api = inject(OTTO_API);

    state(): Promise<WindowState> {
        return requireOttoApi(this.api).window.state();
    }

    minimize(): Promise<void> {
        return requireOttoApi(this.api).window.minimize();
    }

    toggleMaximize(): Promise<void> {
        return requireOttoApi(this.api).window.toggleMaximize();
    }

    close(): Promise<void> {
        return requireOttoApi(this.api).window.close();
    }

    showAppMenu(x: number, y: number): Promise<void> {
        return requireOttoApi(this.api).window.showAppMenu(x, y);
    }

    onStateChanged(listener: (state: WindowState) => void): () => void {
        return this.api?.window.onStateChanged(listener) ?? (() => undefined);
    }
}

@Injectable()
export class ElectronSettingsGateway extends SettingsGateway {
    private readonly api = inject(OTTO_API);

    get(): Promise<OttoSettings> {
        return requireOttoApi(this.api).settings.get();
    }

    set(patch: SettingsPatch): Promise<OttoSettings> {
        return requireOttoApi(this.api).settings.set(patch);
    }

    onChanged(listener: (settings: OttoSettings) => void): () => void {
        return this.api?.settings.onChanged(listener) ?? (() => undefined);
    }
}

@Injectable()
export class ElectronThemeGateway extends ThemeGateway {
    private readonly api = inject(OTTO_API);

    get(): Promise<ThemeState> {
        return requireOttoApi(this.api).theme.get();
    }

    onChanged(listener: (state: ThemeState) => void): () => void {
        return this.api?.theme.onChanged(listener) ?? (() => undefined);
    }
}

@Injectable()
export class ElectronKeybindingsGateway extends KeybindingsGateway {
    private readonly api = inject(OTTO_API);

    get(): Promise<KeybindingOverrides> {
        return requireOttoApi(this.api).keybindings.get();
    }

    set(overrides: KeybindingOverrides): Promise<KeybindingOverrides> {
        return requireOttoApi(this.api).keybindings.set(overrides);
    }

    reset(id?: CommandId): Promise<KeybindingOverrides> {
        return requireOttoApi(this.api).keybindings.reset(id);
    }

    onChanged(listener: (overrides: KeybindingOverrides) => void): () => void {
        return this.api?.keybindings.onChanged(listener) ?? (() => undefined);
    }
}

@Injectable()
export class ElectronHttpGateway extends HttpGateway {
    private readonly api = inject(OTTO_API);

    send(request: HttpRequest): Promise<HttpResult> {
        return requireOttoApi(this.api).http.send(request);
    }

    cancel(id: string): Promise<boolean> {
        return requireOttoApi(this.api).http.cancel(id);
    }
}

@Injectable()
export class ElectronDialogGateway extends DialogGateway {
    private readonly api = inject(OTTO_API);

    pickCertificate(): Promise<string | null> {
        return requireOttoApi(this.api).dialog.pickCertificate();
    }

    pickFile(title: string): Promise<string | null> {
        return requireOttoApi(this.api).dialog.pickFile(title);
    }

    pickOpenApiFile(): Promise<string | null> {
        return requireOttoApi(this.api).dialog.pickOpenApiFile();
    }

    pickCollectionArchive(): Promise<string | null> {
        return requireOttoApi(this.api).dialog.pickCollectionArchive();
    }

    saveCollectionArchive(defaultName: string): Promise<string | null> {
        return requireOttoApi(this.api).dialog.saveCollectionArchive(defaultName);
    }

    saveOpenApiSpec(defaultName: string): Promise<string | null> {
        return requireOttoApi(this.api).dialog.saveOpenApiSpec(defaultName);
    }

    pickWorkspaceArchive(): Promise<string | null> {
        return requireOttoApi(this.api).dialog.pickWorkspaceArchive();
    }

    saveWorkspaceArchive(defaultName: string): Promise<string | null> {
        return requireOttoApi(this.api).dialog.saveWorkspaceArchive(defaultName);
    }

    chooseBaseDirectory(current?: string): Promise<string | null> {
        return requireOttoApi(this.api).dialog.chooseBaseDirectory(current);
    }
}

@Injectable()
export class ElectronMenuEventsGateway extends MenuEventsGateway {
    private readonly api = inject(OTTO_API);

    onMenuAction(listener: (action: MenuAction) => void): () => void {
        return this.api?.onMenuAction(listener) ?? (() => undefined);
    }
}

@Injectable()
export class ElectronTabsGateway extends TabsGateway {
    private readonly api = inject(OTTO_API);

    list(workspaceId: EntityId): Promise<TabState[]> {
        return requireOttoApi(this.api).tabs.list(workspaceId);
    }

    save(workspaceId: EntityId, tabs: TabState[]): Promise<void> {
        return requireOttoApi(this.api).tabs.save(workspaceId, tabs);
    }
}

@Injectable()
export class ElectronWorkspacesGateway extends WorkspacesGateway {
    private readonly api = inject(OTTO_API);

    list(): Promise<WorkspaceSummary[]> {
        return requireOttoApi(this.api).workspaces.list();
    }

    load(): Promise<LoadedWorkspace> {
        return requireOttoApi(this.api).workspaces.load();
    }

    switch(id: EntityId): Promise<Workspace> {
        return requireOttoApi(this.api).workspaces.switch(id);
    }

    create(name: string): Promise<Workspace> {
        return requireOttoApi(this.api).workspaces.create(name);
    }

    rename(id: EntityId, name: string): Promise<Workspace> {
        return requireOttoApi(this.api).workspaces.rename(id, name);
    }

    remove(id: EntityId): Promise<void> {
        return requireOttoApi(this.api).workspaces.remove(id);
    }

    recreate(id: EntityId): Promise<Workspace> {
        return requireOttoApi(this.api).workspaces.recreate(id);
    }

    export(id: EntityId, file: string): Promise<void> {
        return requireOttoApi(this.api).workspaces.export(id, file);
    }

    import(file: string): Promise<Workspace> {
        return requireOttoApi(this.api).workspaces.import(file);
    }

    reveal(id: EntityId): Promise<void> {
        return requireOttoApi(this.api).workspaces.reveal(id);
    }

    moveAll(from: string, to: string): Promise<WorkspaceMoveResult> {
        return requireOttoApi(this.api).workspaces.moveAll(from, to);
    }

    onChanged(listener: () => void): () => void {
        return this.api?.workspaces.onChanged(listener) ?? (() => undefined);
    }
}

@Injectable()
export class ElectronEnvironmentsGateway extends EnvironmentsGateway {
    private readonly api = inject(OTTO_API);

    list(collectionId: EntityId | null): Promise<Environment[]> {
        return requireOttoApi(this.api).environments.list(collectionId);
    }

    get(id: EntityId): Promise<Environment | null> {
        return requireOttoApi(this.api).environments.get(id);
    }

    create(input: NewEnvironment): Promise<Environment> {
        return requireOttoApi(this.api).environments.create(input);
    }

    update(id: EntityId, patch: Partial<NewEnvironment>): Promise<Environment | null> {
        return requireOttoApi(this.api).environments.update(id, patch);
    }

    delete(id: EntityId): Promise<boolean> {
        return requireOttoApi(this.api).environments.delete(id);
    }
}

@Injectable()
export class ElectronCollectionsGateway extends CollectionsGateway {
    private readonly api = inject(OTTO_API);

    list(): Promise<CollectionMetadata[]> {
        return requireOttoApi(this.api).collections.list();
    }

    get(id: EntityId): Promise<CollectionMetadata | null> {
        return requireOttoApi(this.api).collections.get(id);
    }

    create(input: NewCollectionMetadata): Promise<CollectionMetadata> {
        return requireOttoApi(this.api).collections.create(input);
    }

    update(id: EntityId, patch: Partial<NewCollectionMetadata>): Promise<CollectionMetadata | null> {
        return requireOttoApi(this.api).collections.update(id, patch);
    }

    delete(id: EntityId): Promise<boolean> {
        return requireOttoApi(this.api).collections.delete(id);
    }

    createOnDisk(name: string): Promise<OpenedCollection> {
        return requireOttoApi(this.api).collections.createOnDisk(name);
    }

    import(request: CollectionImportRequest): Promise<OpenedCollection> {
        return requireOttoApi(this.api).collections.import(request);
    }

    export(id: EntityId, format: CollectionExportFormat, file: string): Promise<void> {
        return requireOttoApi(this.api).collections.export(id, format, file);
    }

    close(id: EntityId): Promise<void> {
        return requireOttoApi(this.api).collections.close(id);
    }

    trash(id: EntityId): Promise<void> {
        return requireOttoApi(this.api).collections.trash(id);
    }

    tree(id: EntityId): Promise<CollectionTree> {
        return requireOttoApi(this.api).collections.tree(id);
    }

    manifest(id: EntityId): Promise<CollectionManifest> {
        return requireOttoApi(this.api).collections.manifest(id);
    }

    updateManifest(id: EntityId, patch: CollectionManifestPatch): Promise<CollectionManifest> {
        return requireOttoApi(this.api).collections.updateManifest(id, patch);
    }

    updateFolder(id: EntityId, folder: string, patch: Partial<FolderSettings>): Promise<FolderSettings> {
        return requireOttoApi(this.api).collections.updateFolder(id, folder, patch);
    }

    onChanged(listener: (event: { collectionId: EntityId }) => void): () => void {
        return this.api?.collections.onChanged(listener) ?? (() => undefined);
    }
}

@Injectable()
export class ElectronCollectionFilesGateway extends CollectionFilesGateway {
    private readonly api = inject(OTTO_API);

    readRequest(collectionId: EntityId, path: string): Promise<RequestDefinition> {
        return requireOttoApi(this.api).collectionFiles.readRequest(collectionId, path);
    }

    saveRequest(collectionId: EntityId, path: string, request: RequestDefinition): Promise<void> {
        return requireOttoApi(this.api).collectionFiles.saveRequest(collectionId, path, request);
    }

    createRequest(collectionId: EntityId, folder: string, request: RequestDefinition): Promise<string> {
        return requireOttoApi(this.api).collectionFiles.createRequest(collectionId, folder, request);
    }

    createFolder(collectionId: EntityId, parent: string, name: string): Promise<string> {
        return requireOttoApi(this.api).collectionFiles.createFolder(collectionId, parent, name);
    }

    move(collectionId: EntityId, from: string, to: string): Promise<void> {
        return requireOttoApi(this.api).collectionFiles.move(collectionId, from, to);
    }

    duplicate(collectionId: EntityId, path: string, name: string): Promise<string> {
        return requireOttoApi(this.api).collectionFiles.duplicate(collectionId, path, name);
    }

    rename(collectionId: EntityId, path: string, name: string): Promise<string> {
        return requireOttoApi(this.api).collectionFiles.rename(collectionId, path, name);
    }

    reorder(collectionId: EntityId, entries: string[]): Promise<void> {
        return requireOttoApi(this.api).collectionFiles.reorder(collectionId, entries);
    }

    remove(collectionId: EntityId, path: string): Promise<void> {
        return requireOttoApi(this.api).collectionFiles.remove(collectionId, path);
    }

    reveal(collectionId: EntityId, path: string): Promise<void> {
        return requireOttoApi(this.api).collectionFiles.reveal(collectionId, path);
    }
}

@Injectable()
export class ElectronOpenApiGateway extends OpenApiGateway {
    private readonly api = inject(OTTO_API);

    status(collectionId: EntityId, refresh?: boolean): Promise<OpenApiStatus> {
        return requireOttoApi(this.api).openapi.status(collectionId, refresh);
    }

    connect(collectionId: EntityId, config: OpenApiConfig): Promise<OpenApiStatus> {
        return requireOttoApi(this.api).openapi.connect(collectionId, config);
    }

    disconnect(collectionId: EntityId): Promise<void> {
        return requireOttoApi(this.api).openapi.disconnect(collectionId);
    }

    spec(collectionId: EntityId): Promise<string> {
        return requireOttoApi(this.api).openapi.spec(collectionId);
    }

    sync(collectionId: EntityId, keys: string[]): Promise<OpenApiStatus> {
        return requireOttoApi(this.api).openapi.sync(collectionId, keys);
    }

    revert(collectionId: EntityId, keys: string[]): Promise<OpenApiStatus> {
        return requireOttoApi(this.api).openapi.revert(collectionId, keys);
    }
}

@Injectable()
export class ElectronUpdatesGateway extends UpdatesGateway {
    private readonly api = inject(OTTO_API);

    state(): Promise<UpdateState> {
        return requireOttoApi(this.api).updates.state();
    }

    check(): Promise<UpdateState> {
        return requireOttoApi(this.api).updates.check();
    }

    download(): Promise<void> {
        return requireOttoApi(this.api).updates.download();
    }

    install(): Promise<void> {
        return requireOttoApi(this.api).updates.install();
    }

    skip(version: string): Promise<void> {
        return requireOttoApi(this.api).updates.skip(version);
    }

    remindLater(): Promise<void> {
        return requireOttoApi(this.api).updates.remindLater();
    }

    clearSkipped(): Promise<void> {
        return requireOttoApi(this.api).updates.clearSkipped();
    }

    openRelease(): Promise<void> {
        return requireOttoApi(this.api).updates.openRelease();
    }

    onStateChanged(listener: (state: UpdateState) => void): () => void {
        return this.api?.updates.onStateChanged(listener) ?? (() => undefined);
    }

    onOpenRequested(listener: () => void): () => void {
        return this.api?.updates.onOpenRequested(listener) ?? (() => undefined);
    }
}

@Injectable()
export class ElectronMockGateway extends MockGateway {
    private readonly api = inject(OTTO_API);

    list(): Promise<MockServerStatus[]> {
        return requireOttoApi(this.api).mock.list();
    }

    start(collectionId: EntityId, port: number): Promise<MockServerStatus> {
        return requireOttoApi(this.api).mock.start(collectionId, port);
    }

    stop(collectionId: EntityId): Promise<void> {
        return requireOttoApi(this.api).mock.stop(collectionId);
    }

    onChanged(listener: (servers: MockServerStatus[]) => void): () => void {
        return this.api?.mock.onChanged(listener) ?? (() => undefined);
    }
}
