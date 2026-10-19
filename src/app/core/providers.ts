import { inject, makeEnvironmentProviders, provideAppInitializer, type EnvironmentProviders } from '@angular/core';
import {
    ElectronAppInfoGateway,
    ElectronCollectionFilesGateway,
    ElectronCollectionsGateway,
    ElectronDialogGateway,
    ElectronEnvironmentsGateway,
    ElectronHistoryGateway,
    ElectronHttpGateway,
    ElectronMenuEventsGateway,
    ElectronSettingsGateway,
    ElectronTabsGateway,
    ElectronThemeGateway,
    ElectronWindowGateway
} from './adapters/electron/electron-gateways';
import { AppInfoGateway, CollectionFilesGateway, CollectionsGateway, DialogGateway, EnvironmentsGateway, HistoryGateway, HttpGateway, MenuEventsGateway, SettingsGateway, TabsGateway, ThemeGateway, WindowGateway } from './ports';
import { ThemeService } from './theme/theme.service';

/** Liga os ports do renderer às implementações sobre o IPC do Electron. */
export function provideOttoCore(): EnvironmentProviders {
    return makeEnvironmentProviders([
        { provide: AppInfoGateway, useClass: ElectronAppInfoGateway },
        { provide: WindowGateway, useClass: ElectronWindowGateway },
        { provide: SettingsGateway, useClass: ElectronSettingsGateway },
        { provide: ThemeGateway, useClass: ElectronThemeGateway },
        { provide: HttpGateway, useClass: ElectronHttpGateway },
        { provide: DialogGateway, useClass: ElectronDialogGateway },
        { provide: MenuEventsGateway, useClass: ElectronMenuEventsGateway },
        { provide: HistoryGateway, useClass: ElectronHistoryGateway },
        { provide: TabsGateway, useClass: ElectronTabsGateway },
        { provide: EnvironmentsGateway, useClass: ElectronEnvironmentsGateway },
        { provide: CollectionsGateway, useClass: ElectronCollectionsGateway },
        { provide: CollectionFilesGateway, useClass: ElectronCollectionFilesGateway },
        // Aplica o tema antes da primeira renderização das rotas.
        provideAppInitializer(() => {
            inject(ThemeService);
        })
    ]);
}
