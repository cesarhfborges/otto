import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { providePrimeNG } from 'primeng/config';
import { provideOttoCore } from './app/core/providers';
import { OttoPreset } from './app/core/theme/otto-preset';
import { DialogService } from 'primeng/dynamicdialog';
import { provideHighlightOptions } from 'ngx-highlightjs';

export const appConfig: ApplicationConfig = {
    providers: [
        provideZonelessChangeDetection(),
        provideOttoCore(),
        // Uma única instância para as modais dinâmicas (ver `SettingsDialog`).
        DialogService,
        provideHighlightOptions({
            // Só o núcleo + as linguagens usadas (ver `HighlightLanguage` em shared/highlight.ts).
            coreLibraryLoader: () => import('highlight.js/lib/core'),
            // Diretiva `lineNumbers` (visualização da resposta e preview); o editor tem calha própria.
            lineNumbersLoader: () => import('ngx-highlightjs/line-numbers'),
            languages: {
                json: () => import('highlight.js/lib/languages/json'),
                xml: () => import('highlight.js/lib/languages/xml'),
                plaintext: () => import('highlight.js/lib/languages/plaintext')
            }
        }),
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
