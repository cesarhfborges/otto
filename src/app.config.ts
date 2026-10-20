import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { providePrimeNG } from 'primeng/config';
import { DialogService } from 'primeng/dynamicdialog';
import { provideOttoCore } from './app/core/providers';
import { OttoPreset } from './app/core/theme/otto-preset';

export const appConfig: ApplicationConfig = {
    providers: [
        provideZonelessChangeDetection(),
        provideOttoCore(),
        // Uma única instância para as modais dinâmicas (ver `SettingsDialog`).
        DialogService,
        providePrimeNG({
            ripple: false,
            theme: {
                preset: OttoPreset,
                options: {
                    darkModeSelector: '.app-dark'
                }
            }
        })
    ]
};
