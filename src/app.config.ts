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
                plaintext: () => import('highlight.js/lib/languages/plaintext'),
                // Linguagens do "Generate Code" (CODEGEN_TARGETS).
                bash: () => import('highlight.js/lib/languages/bash'),
                javascript: () => import('highlight.js/lib/languages/javascript'),
                python: () => import('highlight.js/lib/languages/python'),
                go: () => import('highlight.js/lib/languages/go'),
                powershell: () => import('highlight.js/lib/languages/powershell'),
                php: () => import('highlight.js/lib/languages/php'),
                java: () => import('highlight.js/lib/languages/java'),
                csharp: () => import('highlight.js/lib/languages/csharp'),
                kotlin: () => import('highlight.js/lib/languages/kotlin'),
                ruby: () => import('highlight.js/lib/languages/ruby'),
                rust: () => import('highlight.js/lib/languages/rust'),
                swift: () => import('highlight.js/lib/languages/swift'),
                dart: () => import('highlight.js/lib/languages/dart')
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
