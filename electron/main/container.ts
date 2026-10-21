import { app, shell } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ICollectionMetadataRepository, IEnvironmentRepository, IHistoryRepository, IHttpExecutor, IIpcModule, IKeybindingService, ISettingsService, ITabRepository } from './core/contracts';
import { FsCollectionStore } from './infra/collections/fs-collection-store';
import { FsCollectionWatcher } from './infra/collections/fs-collection-watcher';
import { YamlCollectionFormat } from './infra/collections/yaml-collection-format';
import { MigrationRunner } from './infra/database/migration-runner';
import { MIGRATIONS } from './infra/database/migrations';
import { openDatabase } from './infra/database/sqlite';
import { SqliteCollectionMetadataRepository } from './infra/repositories/sqlite-collection-metadata.repository';
import { SqliteEnvironmentRepository } from './infra/repositories/sqlite-environment.repository';
import { SqliteKeybindingStore } from './infra/repositories/sqlite-keybinding.store';
import { SqliteHistoryRepository } from './infra/repositories/sqlite-history.repository';
import { SqliteSettingsStore } from './infra/repositories/sqlite-settings.store';
import { SqliteTabRepository } from './infra/repositories/sqlite-tab.repository';
import { SqliteWorkspaceRepository } from './infra/repositories/sqlite-workspace.repository';
import { YamlWorkspaceFormat } from './infra/workspaces/yaml-workspace-format';
import { DEFAULT_ZIP_LIMITS } from './infra/workspaces/zip-archive';
import { defaultBaseDirectory, isMac } from './config';
import { importLegacySettings } from './infra/settings/legacy-settings-import';
import { electronTrash } from './infra/system/electron-trash';
import { systemClock, uuidGenerator } from './infra/system/system';
import { AppIpcModule } from './ipc/app.ipc';
import { CollectionFilesIpcModule } from './ipc/collection-files.ipc';
import { CollectionsIpcModule } from './ipc/collections.ipc';
import { EnvironmentsIpcModule } from './ipc/environments.ipc';
import { HistoryIpcModule } from './ipc/history.ipc';
import { HttpIpcModule } from './ipc/http.ipc';
import { KeybindingsIpcModule } from './ipc/keybindings.ipc';
import { SettingsIpcModule } from './ipc/settings.ipc';
import { ThemeIpcModule } from './ipc/theme.ipc';
import { TabsIpcModule } from './ipc/tabs.ipc';
import { WindowIpcModule } from './ipc/window.ipc';
import { WorkspacesIpcModule } from './ipc/workspaces.ipc';
import { OpenApiIpcModule } from './ipc/openapi.ipc';
import { OpenApiService } from './services/openapi/openapi.service';
import { CollectionService } from './services/collections/collection.service';
import { FetchHttpExecutor } from './services/http/fetch-http-executor';
import { HistoryRecordingExecutor } from './services/http/history-recording-executor';
import { ImporterRegistry } from './services/import/importer-registry';
import { KeybindingService } from './services/keybindings/keybinding.service';
import { SettingsService } from './services/settings/settings.service';
import { WorkspaceService, type ArchiveFiles } from './services/workspaces/workspace.service';
import { AppCommands } from './ui/commands';
import { DialogService } from './ui/dialogs';
import { ThemeController } from './ui/theme';
import { TrayManager } from './ui/tray';
import { WindowManager } from './ui/window';

export interface Container {
    settings: ISettingsService;
    keybindings: IKeybindingService;
    theme: ThemeController;
    history: IHistoryRepository;
    tabs: ITabRepository;
    environments: IEnvironmentRepository;
    collections: ICollectionMetadataRepository;
    collectionService: CollectionService;
    workspaceService: WorkspaceService;
    http: IHttpExecutor;
    importers: ImporterRegistry;
    window: WindowManager;
    commands: AppCommands;
    tray: TrayManager;
    ipcModules: IIpcModule[];
    /** Libera recursos (fecha o banco). Chamar ao encerrar o app. */
    dispose(): void;
}

/**
 * Composition root (DIP): único lugar que conhece as implementações concretas.
 * Os demais módulos dependem apenas dos contratos em `core/contracts`.
 * Deve ser chamado após `app.whenReady()` (usa `app.getPath`).
 */
export function createContainer(): Container {
    const userData = app.getPath('userData');
    const db = openDatabase(path.join(userData, 'otto.db'));

    try {
        new MigrationRunner(db, MIGRATIONS, systemClock).migrate();
    } catch (error) {
        db.close();
        throw error;
    }

    const settingsStore = new SqliteSettingsStore(db, systemClock);

    importLegacySettings(path.join(userData, 'settings.json'), settingsStore);

    const settings = new SettingsService(settingsStore);
    const keybindings = new KeybindingService(new SqliteKeybindingStore(db, systemClock, isMac));

    const history = new SqliteHistoryRepository(db, systemClock, uuidGenerator);
    const tabs = new SqliteTabRepository(db);
    const environments = new SqliteEnvironmentRepository(db, systemClock, uuidGenerator);
    const collections = new SqliteCollectionMetadataRepository(db, systemClock, uuidGenerator);
    const store = new FsCollectionStore(electronTrash);
    const collectionService = new CollectionService(store, new YamlCollectionFormat(), collections, new FsCollectionWatcher(), systemClock);
    const archives: ArchiveFiles = {
        read: async (file) => {
            if ((await fs.stat(file)).size > DEFAULT_ZIP_LIMITS.maxTotalBytes) {
                throw new Error('The archive is too large to import');
            }

            return fs.readFile(file);
        },
        write: (file, content) => fs.writeFile(file, content)
    };
    const workspaceService = new WorkspaceService(
        new SqliteWorkspaceRepository(db, systemClock, uuidGenerator),
        collections,
        collectionService,
        store,
        new YamlWorkspaceFormat(),
        archives,
        environments,
        systemClock,
        () => settings.get().workspaces.baseDirectory || defaultBaseDirectory()
    );
    const importers = new ImporterRegistry();
    const window = new WindowManager(settings, settingsStore);
    const httpBase = new FetchHttpExecutor({ settings: () => settings.get().http, userAgent: `Otto/${app.getVersion()}` });
    const http = new HistoryRecordingExecutor(httpBase, history, {
        maxEntries: () => settings.get().history.maxEntries,
        onRecorded: () => window.notify('history:changed', null),
        onError: (error) => console.error('[otto] could not record history:', error)
    });
    // Busca de specs usa o executor base (proxy/SSL das preferências) sem gravar no histórico.
    const openapi = new OpenApiService(
        collectionService,
        httpBase,
        {
            read: async (file) => {
                if ((await fs.stat(file)).size > 20_000_000) {
                    throw new Error('The spec file is too large');
                }

                return fs.readFile(file, 'utf8');
            },
            write: (file, content) => fs.writeFile(file, content, 'utf8')
        },
        environments,
        systemClock
    );
    const theme = new ThemeController(settings, window);
    const dialogs = new DialogService(() => window.current);
    const commands = new AppCommands(window, dialogs);
    const tray = new TrayManager(window, settings, commands);

    return {
        settings,
        keybindings,
        theme,
        history,
        tabs,
        environments,
        collections,
        collectionService,
        workspaceService,
        http,
        importers,
        window,
        commands,
        tray,
        ipcModules: [
            new AppIpcModule(dialogs),
            new WindowIpcModule(window),
            new SettingsIpcModule(settings, window),
            new ThemeIpcModule(theme),
            new KeybindingsIpcModule(keybindings, window, isMac),
            new HttpIpcModule(http),
            new HistoryIpcModule(history),
            new TabsIpcModule(tabs),
            new WorkspacesIpcModule(workspaceService, window, (folder) => shell.showItemInFolder(path.join(folder, 'workspace.yaml'))),
            new EnvironmentsIpcModule(environments, () => workspaceService.active().id),
            new CollectionsIpcModule(collections, collectionService, workspaceService, openapi, window),
            new OpenApiIpcModule(openapi),
            new CollectionFilesIpcModule(collectionService, (file) => shell.showItemInFolder(file))
        ],
        dispose: () => {
            collectionService.closeAll();
            void httpBase.dispose();
            if (db.isOpen) {
                db.close();
            }
        }
    };
}
