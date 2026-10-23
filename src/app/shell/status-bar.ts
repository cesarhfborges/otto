import { Component, computed, inject, signal } from '@angular/core';
import type { ThemeMode } from '@shared/models';
import { Title } from '@angular/platform-browser';
import { TieredMenuModule } from 'primeng/tieredmenu';
import { TooltipModule } from 'primeng/tooltip';
import { AppInfoGateway } from '../core/ports';
import { ThemeService } from '../core/theme/theme.service';
import { MenuItem, TooltipOptions } from 'primeng/api';
import { SettingsDialog } from '../features/settings/settings-dialog.service';
import { UpdateDialog } from '../features/updates/update-dialog';
import { UpdatesState } from '../core/state/updates.state';

const THEME_OPTIONS: readonly { mode: ThemeMode; label: string; icon: string }[] = [
    { mode: 'dark', label: 'Dark', icon: 'pi pi-moon' },
    { mode: 'light', label: 'Light', icon: 'pi pi-sun' },
    { mode: 'auto', label: 'Auto (system)', icon: 'pi pi-desktop' }
];

/** Barra de status: atalhos para preferências e tema, versão do app. */
@Component({
    selector: 'app-status-bar',
    imports: [TooltipModule, TieredMenuModule, UpdateDialog],
    template: `
        <button type="button" class="otto-icon-button !h-6 !w-7" aria-label="Preferences" pTooltip [tooltipOptions]="tooltipConfig" (click)="settingsDialog.open()">
            <i class="pi pi-cog text-xs" aria-hidden="true"></i>
        </button>
        <button type="button" class="otto-icon-button h-6! w-7!" [attr.aria-label]="themeLabel()" aria-haspopup="menu" pTooltip [tooltipOptions]="tooltipColor()" (click)="themeMenu.toggle($event)">
            <i class="text-xs" [class]="themeIcon()" aria-hidden="true"></i>
        </button>
        <p-tiered-menu #themeMenu [model]="themeItems()" [popup]="true" appendTo="body">
            <ng-template #item let-item>
                <a class="p-tieredmenu-item-link">
                    <span class="p-tieredmenu-item-icon" [class]="item.icon" aria-hidden="true"></span>
                    <span class="p-tieredmenu-item-label">{{ item.label }}</span>
                    @if (item.state?.selected) {
                        <i class="pi pi-check ml-auto pl-3 text-xs" aria-hidden="true"></i>
                        <span class="sr-only">(current)</span>
                    }
                </a>
            </ng-template>
        </p-tiered-menu>
        <span class="ml-auto" aria-live="polite">
            @if (updates.pending()) {
                <button type="button" class="flex h-6 items-center gap-1.5 rounded px-2 text-xs font-medium text-primary hover:bg-surface-200 dark:hover:bg-surface-800" [attr.aria-label]="updateLabel()" (click)="updates.open()">
                    <i class="pi text-xs" [class]="updateIcon()" aria-hidden="true"></i>
                    {{ updateText() }}
                </button>
            }
        </span>
        <app-update-dialog />
        @if (beta()) {
            <span class="rounded bg-orange-100 px-1.5 text-xs font-semibold text-orange-800 dark:bg-orange-900 dark:text-orange-100" title="Pre-release build for testing">BETA</span>
        }
        <span class="px-2 text-xs text-muted-color">{{ version() }}</span>
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
    protected readonly updates = inject(UpdatesState);
    protected readonly updateText = computed(() => {
        const state = this.updates.state();

        switch (state?.phase) {
            case 'downloading':
                return `Downloading ${Math.round(state.progress?.percent ?? 0)}%`;
            case 'downloaded':
                return 'Restart to update';
            default:
                return 'Update available';
        }
    });
    protected readonly updateIcon = computed(() => (this.updates.state()?.phase === 'downloaded' ? 'pi pi-refresh' : 'pi pi-arrow-circle-down'));
    protected readonly updateLabel = computed(() => `${this.updateText()}: version ${this.updates.state()?.info?.version ?? ''}. Open software update`);
    /** Pré-releases (`1.2.0-beta.3`) são sinalizadas na barra e no título da janela. */
    protected readonly beta = computed(() => this.version().includes('-beta'));
    private readonly title = inject(Title);
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

    private readonly currentTheme = computed(() => THEME_OPTIONS.find((option) => option.mode === this.theme.mode()) ?? THEME_OPTIONS[0]);
    protected readonly themeIcon = computed(() => this.currentTheme().icon);
    protected readonly themeLabel = computed(() => `Theme: ${this.currentTheme().label}`);
    protected readonly tooltipColor = computed<TooltipOptions>(() => ({
        tooltipLabel: this.themeLabel(),
        positionLeft: -30,
        positionTop: -32,
        tooltipEvent: 'hover',
        tooltipPosition: 'top'
        // tooltipPosition="top"
        // appendTo="body"
    }));
    protected readonly themeItems = computed<MenuItem[]>(() =>
        THEME_OPTIONS.map(({ mode, label, icon }) => ({
            label,
            icon,
            state: { selected: mode === this.theme.mode() },
            command: () => void this.theme.setMode(mode)
        }))
    );

    constructor() {
        inject(AppInfoGateway)
            .info()
            .then(
                (info) => {
                    this.version.set(`v${info.version}`);

                    if (this.beta()) {
                        this.title.setTitle(`Otto Beta ${info.version}`);
                    }
                },
                () => undefined
            );
    }
}
