import { inject, Injectable } from '@angular/core';
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
import { OTTO_API, requireOttoApi } from '../../bridge/otto-api.token';
import { AppInfoGateway, CollectionFilesGateway, CollectionsGateway, DialogGateway, EnvironmentsGateway, HistoryGateway, HttpGateway, MenuEventsGateway, SettingsGateway, TabsGateway, ThemeGateway, WindowGateway } from '../../ports';

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

    openCollection(): Promise<string | null> {
        return requireOttoApi(this.api).dialog.openCollection();
    }

    pickCertificate(): Promise<string | null> {
        return requireOttoApi(this.api).dialog.pickCertificate();
    }

    chooseCollectionLocation(): Promise<string | null> {
        return requireOttoApi(this.api).dialog.chooseCollectionLocation();
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
export class ElectronHistoryGateway extends HistoryGateway {
    private readonly api = inject(OTTO_API);

    list(query?: HistoryQuery): Promise<HistoryEntry[]> {
        return requireOttoApi(this.api).history.list(query);
    }

    delete(id: EntityId): Promise<boolean> {
        return requireOttoApi(this.api).history.delete(id);
    }

    clear(): Promise<number> {
        return requireOttoApi(this.api).history.clear();
    }
}

@Injectable()
export class ElectronTabsGateway extends TabsGateway {
    private readonly api = inject(OTTO_API);

    list(): Promise<TabState[]> {
        return requireOttoApi(this.api).tabs.list();
    }

    save(tabs: TabState[]): Promise<void> {
        return requireOttoApi(this.api).tabs.save(tabs);
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

    open(directory: string): Promise<OpenedCollection> {
        return requireOttoApi(this.api).collections.open(directory);
    }

    createOnDisk(parentDirectory: string, name: string): Promise<OpenedCollection> {
        return requireOttoApi(this.api).collections.createOnDisk(parentDirectory, name);
    }

    close(id: EntityId): Promise<void> {
        return requireOttoApi(this.api).collections.close(id);
    }

    tree(id: EntityId): Promise<CollectionTree> {
        return requireOttoApi(this.api).collections.tree(id);
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

    remove(collectionId: EntityId, path: string): Promise<void> {
        return requireOttoApi(this.api).collectionFiles.remove(collectionId, path);
    }
}
