import { QuitGuardState } from './state/quit-guard.state';
import { inject, makeEnvironmentProviders, provideAppInitializer, type EnvironmentProviders } from '@angular/core';
import {
    ElectronAppInfoGateway,
    ElectronCollectionFilesGateway,
    ElectronCollectionsGateway,
    ElectronDialogGateway,
    ElectronEnvironmentsGateway,
    ElectronHistoryGateway,
    ElectronHttpGateway,
    ElectronKeybindingsGateway,
    ElectronMenuEventsGateway,
    ElectronSettingsGateway,
    ElectronTabsGateway,
    ElectronThemeGateway,
    ElectronWindowGateway,
    ElectronWorkspacesGateway,
    ElectronOpenApiGateway
} from './adapters/electron/electron-gateways';
import {
    AppInfoGateway,
    CollectionFilesGateway,
    CollectionsGateway,
    DialogGateway,
    EnvironmentsGateway,
    HistoryGateway,
    HttpGateway,
    KeybindingsGateway,
    MenuEventsGateway,
    SettingsGateway,
    TabsGateway,
    ThemeGateway,
    WindowGateway,
    WorkspacesGateway,
    OpenApiGateway
} from './ports';
import { KeybindingService } from './keyboard/keybinding.service';
import { ThemeService } from './theme/theme.service';

/** Liga os ports do renderer às implementações sobre o IPC do Electron. */
export function provideOttoCore(): EnvironmentProviders {
    return makeEnvironmentProviders([
        { provide: AppInfoGateway, useClass: ElectronAppInfoGateway },
        { provide: WindowGateway, useClass: ElectronWindowGateway },
        { provide: SettingsGateway, useClass: ElectronSettingsGateway },
        { provide: ThemeGateway, useClass: ElectronThemeGateway },
        { provide: HttpGateway, useClass: ElectronHttpGateway },
        { provide: KeybindingsGateway, useClass: ElectronKeybindingsGateway },
        { provide: DialogGateway, useClass: ElectronDialogGateway },
        { provide: MenuEventsGateway, useClass: ElectronMenuEventsGateway },
        { provide: HistoryGateway, useClass: ElectronHistoryGateway },
        { provide: TabsGateway, useClass: ElectronTabsGateway },
        { provide: WorkspacesGateway, useClass: ElectronWorkspacesGateway },
        { provide: EnvironmentsGateway, useClass: ElectronEnvironmentsGateway },
        { provide: CollectionsGateway, useClass: ElectronCollectionsGateway },
        { provide: CollectionFilesGateway, useClass: ElectronCollectionFilesGateway },
        { provide: OpenApiGateway, useClass: ElectronOpenApiGateway },
        // Aplica o tema antes da primeira renderização das rotas.
        provideAppInitializer(() => {
            inject(ThemeService);
            // Começa a escutar o teclado; os comandos são registrados pelo shell e pelas telas.
            inject(KeybindingService);
            // Confirma alterações não salvas antes de encerrar o app.
            inject(QuitGuardState);
        })
    ]);
}
