import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withEnabledBlockingInitialNavigation, withHashLocation, withInMemoryScrolling } from '@angular/router';
import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';
import { providePrimeNG } from 'primeng/config';
import { appRoutes } from './app.routes';
import { provideOttoCore } from './app/core/providers';
import { ACCESSIBLE_TOKENS } from './app/core/theme/accessible-tokens';

export const appConfig: ApplicationConfig = {
    providers: [
        provideRouter(appRoutes, withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' }), withEnabledBlockingInitialNavigation(), withHashLocation()),
        provideHttpClient(withFetch()),
        provideZonelessChangeDetection(),
        provideOttoCore(),
        providePrimeNG({ theme: { preset: definePreset(Aura, ACCESSIBLE_TOKENS), options: { darkModeSelector: '.app-dark' } } })
    ]
};
