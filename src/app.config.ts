import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { providePrimeNG } from 'primeng/config';
import { provideOttoCore } from './app/core/providers';
import { OttoPreset } from './app/core/theme/otto-preset';

export const appConfig: ApplicationConfig = {
    providers: [provideZonelessChangeDetection(), provideOttoCore(), providePrimeNG({ ripple: false, theme: { preset: OttoPreset, options: { darkModeSelector: '.app-dark' } } })]
};
