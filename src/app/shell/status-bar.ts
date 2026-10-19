import { Component, inject, signal } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';
import { AppInfoGateway } from '../core/ports';
import { TabsState } from '../core/state/tabs.state';
import { ThemeService } from '../core/theme/theme.service';

/** Barra de status: atalhos para preferências e tema, versão do app. */
@Component({
    selector: 'app-status-bar',
    imports: [TooltipModule],
    template: `
        <button type="button" class="otto-icon-button !h-6 !w-7" aria-label="Preferences" pTooltip="Preferences" tooltipPosition="top" (click)="openPreferences()">
            <i class="pi pi-cog text-xs" aria-hidden="true"></i>
        </button>
        <button
            type="button"
            class="otto-icon-button !h-6 !w-7"
            [attr.aria-label]="theme.isDark() ? 'Switch to light theme' : 'Switch to dark theme'"
            [pTooltip]="theme.isDark() ? 'Light theme' : 'Dark theme'"
            tooltipPosition="top"
            (click)="theme.toggle()"
        >
            <i class="pi text-xs" [class.pi-sun]="theme.isDark()" [class.pi-moon]="!theme.isDark()" aria-hidden="true"></i>
        </button>
        <span class="ml-auto px-2 text-xs text-muted-color">{{ version() }}</span>
    `,
    host: {
        role: 'contentinfo',
        class: 'flex h-7 shrink-0 items-center gap-0.5 border-t border-surface-200 bg-surface-50 px-1.5 dark:border-surface-800 dark:bg-surface-900'
    }
})
export class StatusBar {
    protected readonly theme = inject(ThemeService);
    private readonly tabs = inject(TabsState);
    protected readonly version = signal('');

    constructor() {
        inject(AppInfoGateway)
            .info()
            .then(
                (info) => this.version.set(`v${info.version}`),
                () => undefined
            );
    }

    protected openPreferences(): void {
        this.tabs.open({ kind: 'settings', title: 'Preferences', collectionId: null });
    }
}
