import { app } from 'electron';
import * as path from 'node:path';
import type { ICollectionMetadataRepository, IEnvironmentRepository, IHistoryRepository, IHttpExecutor, IIpcModule, ISettingsService, ITabRepository } from './core/contracts';
import { MigrationRunner } from './infra/database/migration-runner';
import { MIGRATIONS } from './infra/database/migrations';
import { openDatabase } from './infra/database/sqlite';
import { SqliteCollectionMetadataRepository } from './infra/repositories/sqlite-collection-metadata.repository';
import { SqliteEnvironmentRepository } from './infra/repositories/sqlite-environment.repository';
import { SqliteHistoryRepository } from './infra/repositories/sqlite-history.repository';
import { SqliteSettingsStore } from './infra/repositories/sqlite-settings.store';
import { SqliteTabRepository } from './infra/repositories/sqlite-tab.repository';
import { importLegacySettings } from './infra/settings/legacy-settings-import';
import { systemClock, uuidGenerator } from './infra/system/system';
import { AppIpcModule } from './ipc/app.ipc';
import { CollectionsIpcModule } from './ipc/collections.ipc';
import { EnvironmentsIpcModule } from './ipc/environments.ipc';
import { HistoryIpcModule } from './ipc/history.ipc';
import { HttpIpcModule } from './ipc/http.ipc';
import { SettingsIpcModule } from './ipc/settings.ipc';
import { ThemeIpcModule } from './ipc/theme.ipc';
import { TabsIpcModule } from './ipc/tabs.ipc';
import { FetchHttpExecutor } from './services/http/fetch-http-executor';
import { ImporterRegistry } from './services/import/importer-registry';
import { SettingsService } from './services/settings/settings.service';
import { AppCommands } from './ui/commands';
import { DialogService } from './ui/dialogs';
import { ThemeController } from './ui/theme';
import { TrayManager } from './ui/tray';
import { WindowManager } from './ui/window';

export interface Container {
    settings: ISettingsService;
    theme: ThemeController;
    history: IHistoryRepository;
    tabs: ITabRepository;
    environments: IEnvironmentRepository;
    collections: ICollectionMetadataRepository;
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

    const history = new SqliteHistoryRepository(db, systemClock, uuidGenerator);
    const tabs = new SqliteTabRepository(db);
    const environments = new SqliteEnvironmentRepository(db, systemClock, uuidGenerator);
    const collections = new SqliteCollectionMetadataRepository(db, systemClock, uuidGenerator);
    const http = new FetchHttpExecutor(() => settings.get().http);
    const importers = new ImporterRegistry();
    const window = new WindowManager(settings, settingsStore);
    const theme = new ThemeController(settings, window);
    const dialogs = new DialogService(() => window.current);
    const commands = new AppCommands(window, dialogs);
    const tray = new TrayManager(window, settings, commands);

    return {
        settings,
        theme,
        history,
        tabs,
        environments,
        collections,
        http,
        importers,
        window,
        commands,
        tray,
        ipcModules: [
            new AppIpcModule(dialogs),
            new SettingsIpcModule(settings, window),
            new ThemeIpcModule(theme),
            new HttpIpcModule(http),
            new HistoryIpcModule(history),
            new TabsIpcModule(tabs),
            new EnvironmentsIpcModule(environments),
            new CollectionsIpcModule(collections)
        ],
        dispose: () => {
            if (db.isOpen) {
                db.close();
            }
        }
    };
}
