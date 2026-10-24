import { app, shell } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { OttoSettings } from '../shared/models';
import type { ICollectionMetadataRepository, IEnvironmentRepository, IHttpExecutor, IIpcModule, IKeybindingService, ISettingsService, ITabRepository } from './core/contracts';
import { FsCollectionStore } from './infra/collections/fs-collection-store';
import { moveFolder } from './infra/workspaces/move-folder';
import { FsCollectionWatcher } from './infra/collections/fs-collection-watcher';
import { YamlCollectionFormat } from './infra/collections/yaml-collection-format';
import { MigrationRunner } from './infra/database/migration-runner';
import { MIGRATIONS } from './infra/database/migrations';
import { openDatabase } from './infra/database/sqlite';
import { SqliteCollectionMetadataRepository } from './infra/repositories/sqlite-collection-metadata.repository';
import { SqliteEnvironmentRepository } from './infra/repositories/sqlite-environment.repository';
import { EncryptedEnvironmentRepository } from './infra/repositories/encrypted-environment.repository';
import { createSafeStorageCipher } from './infra/system/safe-storage-cipher';
import { SqliteKeybindingStore } from './infra/repositories/sqlite-keybinding.store';
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
import { HttpIpcModule } from './ipc/http.ipc';
import { KeybindingsIpcModule } from './ipc/keybindings.ipc';
import { SettingsIpcModule } from './ipc/settings.ipc';
import { ThemeIpcModule } from './ipc/theme.ipc';
import { TabsIpcModule } from './ipc/tabs.ipc';
import { WindowIpcModule } from './ipc/window.ipc';
import { WorkspacesIpcModule } from './ipc/workspaces.ipc';
import { OpenApiIpcModule } from './ipc/openapi.ipc';
import { UpdatesIpcModule } from './ipc/updates.ipc';
import { MockIpcModule } from './ipc/mock.ipc';
import { MockServerService } from './services/mock/mock-server.service';
import { createOAuth2Authorizer } from './ui/oauth2-window';
import { OpenApiService } from './services/openapi/openapi.service';
import { CollectionService } from './services/collections/collection.service';
import { FetchHttpExecutor } from './services/http/fetch-http-executor';
import { ImporterRegistry } from './services/import/importer-registry';
import { KeybindingService } from './services/keybindings/keybinding.service';
import { SettingsService } from './services/settings/settings.service';
import { UpdateService } from './services/updates/update.service';
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
    updates: UpdateService;
    ipcModules: IIpcModule[];
    /** Libera recursos (fecha o banco). Chamar ao encerrar o app. */
    dispose(): void;
}

/**
 * Abre e migra o banco local. Pode ser chamado antes de `app.whenReady()`: o main
 * precisa ler preferências que só valem na inicialização (aceleração de hardware).
 */
export function openAppDatabase(): DatabaseSync {
    const db = openDatabase(path.join(app.getPath('userData'), 'otto.db'));

    try {
        new MigrationRunner(db, MIGRATIONS, systemClock).migrate();
    } catch (error) {
        db.close();
        throw error;
    }

    return db;
}

/** Preferências lidas antes do `ready` (o container ainda não existe). */
export function readStartupSettings(db: DatabaseSync): OttoSettings {
    return new SqliteSettingsStore(db, systemClock).get();
}

/**
 * Composition root (DIP): único lugar que conhece as implementações concretas.
 * Os demais módulos dependem apenas dos contratos em `core/contracts`.
 * Deve ser chamado após `app.whenReady()` (usa `app.getPath`).
 * `hardwareAcceleration` é o estado aplicado nesta execução (exibido nas preferências).
 */
export function createContainer(db: DatabaseSync, hardwareAcceleration: boolean): Container {
    const userData = app.getPath('userData');
    // Cofre: segredos (variáveis secretas, senhas de certificados) cifrados no banco com o chaveiro do sistema.
    const secretCipher = createSafeStorageCipher();
    const settingsStore = new SqliteSettingsStore(db, systemClock, secretCipher);

    importLegacySettings(path.join(userData, 'settings.json'), settingsStore);

    const settings = new SettingsService(settingsStore);
    const keybindings = new KeybindingService(new SqliteKeybindingStore(db, systemClock, isMac));

    const tabs = new SqliteTabRepository(db);
    const environments = new EncryptedEnvironmentRepository(new SqliteEnvironmentRepository(db, systemClock, uuidGenerator), secretCipher);

    try {
        environments.encryptPlainSecrets();
    } catch (error) {
        console.error('[otto] could not encrypt stored secrets:', error);
    }

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
        () => settings.get().workspaces.baseDirectory || defaultBaseDirectory(),
        moveFolder
    );
    const importers = new ImporterRegistry();
    const window = new WindowManager(settings, settingsStore);
    const http = new FetchHttpExecutor({ settings: () => settings.get().http, userAgent: `Otto/${app.getVersion()}`, oauth2Authorizer: createOAuth2Authorizer(() => window.current) });
    const openapi = new OpenApiService(
        collectionService,
        http,
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
    const updates = new UpdateService(settings);
    const mocks = new MockServerService(collectionService, (servers) => window.notify('mock:changed', servers));
    const tray = new TrayManager(window, settings, commands);

    return {
        settings,
        keybindings,
        theme,
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
        updates,
        ipcModules: [
            new AppIpcModule(dialogs, hardwareAcceleration, window, secretCipher.storage),
            new WindowIpcModule(window),
            new SettingsIpcModule(settings, window),
            new ThemeIpcModule(theme),
            new KeybindingsIpcModule(keybindings, window, isMac),
            new HttpIpcModule(http),
            new TabsIpcModule(tabs),
            new WorkspacesIpcModule(workspaceService, window, (folder) => shell.showItemInFolder(path.join(folder, 'workspace.yaml'))),
            new EnvironmentsIpcModule(environments, () => workspaceService.active().id, () => workspaceService.saveEnvironments().catch((error: unknown) => console.warn('[otto] could not write the environments to workspace.yaml', error))),
            new CollectionsIpcModule(collections, collectionService, workspaceService, openapi, window),
            new OpenApiIpcModule(openapi),
            new CollectionFilesIpcModule(collectionService, (file) => shell.showItemInFolder(file)),
            new UpdatesIpcModule(updates, window),
            new MockIpcModule(mocks)
        ],
        dispose: () => {
            updates.stop();
            void mocks.dispose();
            collectionService.closeAll();
            void http.dispose();
            if (db.isOpen) {
                db.close();
            }
        }
    };
}
