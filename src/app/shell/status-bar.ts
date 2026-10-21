import { Component, computed, inject, signal } from '@angular/core';
import type { ThemeMode } from '@shared/models';
import { TooltipModule } from 'primeng/tooltip';
import { AppInfoGateway } from '../core/ports';
import { ThemeService } from '../core/theme/theme.service';
import { TooltipOptions } from 'primeng/api';
import { SettingsDialog } from '../features/settings/settings-dialog.service';

const THEME_ICONS: Record<ThemeMode, string> = { dark: 'pi-moon', light: 'pi-sun', auto: 'pi-desktop' };
const THEME_NAMES: Record<ThemeMode, string> = { dark: 'dark', light: 'light', auto: 'auto (system)' };

/** Barra de status: atalhos para preferências e tema, versão do app. */
@Component({
    selector: 'app-status-bar',
    imports: [TooltipModule],
    template: `
        <button type="button" class="otto-icon-button !h-6 !w-7" aria-label="Preferences" pTooltip [tooltipOptions]="tooltipConfig" (click)="settingsDialog.open()">
            <i class="pi pi-cog text-xs" aria-hidden="true"></i>
        </button>
        <button type="button" class="otto-icon-button h-6! w-7!" [attr.aria-label]="themeLabel()" pTooltip [tooltipOptions]="tooltipColor()" (click)="theme.toggle()">
            <i class="pi text-xs" [class]="themeIcon()" aria-hidden="true"></i>
        </button>
        <span class="ml-auto px-2 text-xs text-muted-color">{{ version() }}</span>
    `,
    host: {
        role: 'contentinfo',
        class: 'flex h-7 shrink-0 items-center gap-0.5 border-t border-surface-200 bg-surface-50 px-1.5 dark:border-surface-800 dark:bg-surface-900'
    }
})
export class StatusBar {
    protected readonly settingsDialog = inject(SettingsDialog);
    protected readonly theme = inject(ThemeService);
    protected readonly version = signal('');
    protected readonly tooltipConfig: TooltipOptions = {
        tooltipLabel: 'Preferences',
        positionLeft: -30,
        positionTop: -32,
        tooltipEvent: 'hover',
        tooltipPosition: 'top'
        // tooltipZIndex: '99999',
        // appendTo: 'body'
        // tooltipPosition="top"
        // appendTo="body"
    };
    protected readonly themeIcon = computed(() => THEME_ICONS[this.theme.mode()]);
    protected readonly themeLabel = computed(() => `Theme: ${THEME_NAMES[this.theme.mode()]} — switch to ${THEME_NAMES[this.theme.nextMode()]}`);
    protected readonly tooltipColor = computed<TooltipOptions>(() => ({
        tooltipLabel: this.themeLabel(),
        positionLeft: -30,
        positionTop: -32,
        tooltipEvent: 'hover',
        tooltipPosition: 'top'
        // tooltipPosition="top"
        // appendTo="body"
    }));

    constructor() {
        inject(AppInfoGateway)
            .info()
            .then(
                (info) => this.version.set(`v${info.version}`),
                () => undefined
            );
    }
}
