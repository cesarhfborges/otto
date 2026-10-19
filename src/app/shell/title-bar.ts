import { NgOptimizedImage } from '@angular/common';
import { Component, inject } from '@angular/core';
import type { MenuItem } from 'primeng/api';
import { MenuModule } from 'primeng/menu';
import { TooltipModule } from 'primeng/tooltip';
import { TabsState } from '../core/state/tabs.state';
import { UiState } from '../core/state/ui.state';
import { WindowControlsState } from '../core/state/window-controls.state';

/**
 * Barra de título própria (a janela não tem moldura nativa): menu da aplicação,
 * workspace, título e controles da janela. A barra arrasta a janela; os botões não.
 */
@Component({
    selector: 'app-title-bar',
    imports: [NgOptimizedImage, MenuModule, TooltipModule],
    template: `
        <div class="app-no-drag flex items-center gap-0.5" [style.padding-left.rem]="windowControls.isMac ? 4.5 : null">
            @if (windowControls.available && !windowControls.isMac) {
                <button #menuButton type="button" class="otto-icon-button" aria-label="Application menu" pTooltip="Menu" tooltipPosition="bottom" (click)="windowControls.showAppMenu(menuButton)">
                    <i class="pi pi-bars" aria-hidden="true"></i>
                </button>
            }
            <button type="button" class="otto-icon-button" aria-label="Workspace home" pTooltip="Home" tooltipPosition="bottom" (click)="goHome()">
                <i class="pi pi-home" aria-hidden="true"></i>
            </button>
            <button type="button" class="otto-icon-button !w-auto gap-1.5 px-2 text-sm font-semibold !text-color" aria-haspopup="menu" (click)="workspaceMenu.toggle($event)">
                My Workspace
                <i class="pi pi-chevron-down text-xs text-muted-color" aria-hidden="true"></i>
            </button>
            <p-menu #workspaceMenu [model]="workspaceItems" [popup]="true" appendTo="body" />
        </div>

        <div class="pointer-events-none absolute inset-x-0 mx-auto flex w-fit items-center gap-2 text-sm font-semibold" aria-hidden="true">
            <img ngSrc="favicon.png" width="16" height="16" alt="" />
            Otto
        </div>

        <div class="app-no-drag ml-auto flex items-center gap-0.5">
            <button type="button" class="otto-icon-button" [attr.aria-pressed]="ui.sidebarVisible()" aria-label="Toggle sidebar" pTooltip="Toggle sidebar" tooltipPosition="bottom" (click)="ui.toggleSidebar()">
                <i class="pi pi-objects-column" aria-hidden="true"></i>
            </button>

            @if (windowControls.available && !windowControls.isMac) {
                <span class="mx-1 h-4 w-px bg-surface-200 dark:bg-surface-700" aria-hidden="true"></span>
                <button type="button" class="otto-icon-button !w-10" aria-label="Minimize" (click)="windowControls.minimize()">
                    <i class="pi pi-minus text-xs" aria-hidden="true"></i>
                </button>
                <button type="button" class="otto-icon-button !w-10" [attr.aria-label]="windowControls.maximized() ? 'Restore' : 'Maximize'" (click)="windowControls.toggleMaximize()">
                    <i class="pi text-xs" [class.pi-clone]="windowControls.maximized()" [class.pi-stop]="!windowControls.maximized()" aria-hidden="true"></i>
                </button>
                <button type="button" class="otto-icon-button !w-10 hover:!bg-red-600 hover:!text-white" aria-label="Close" (click)="windowControls.close()">
                    <i class="pi pi-times text-xs" aria-hidden="true"></i>
                </button>
            }
        </div>
    `,
    host: {
        role: 'banner',
        class: 'app-drag relative flex h-9 shrink-0 items-center border-b border-surface-200 bg-surface-50 px-1.5 dark:border-surface-800 dark:bg-surface-900',
        '(dblclick)': 'onDoubleClick($event)'
    }
})
export class TitleBar {
    protected readonly windowControls = inject(WindowControlsState);
    protected readonly ui = inject(UiState);
    private readonly tabs = inject(TabsState);

    protected readonly workspaceItems: MenuItem[] = [
        { label: 'Overview', icon: 'pi pi-home', command: () => this.tabs.open({ kind: 'overview', title: 'Overview', collectionId: null }) },
        { label: 'Environments', icon: 'pi pi-globe', command: () => this.tabs.open({ kind: 'environments', title: 'Environments', collectionId: null }) },
        { separator: true },
        { label: 'Preferences', icon: 'pi pi-cog', command: () => this.tabs.open({ kind: 'settings', title: 'Preferences', collectionId: null }) }
    ];

    protected goHome(): void {
        this.tabs.setContext(null);
    }

    /** Duplo clique na área livre maximiza/restaura, como numa barra de título nativa. */
    protected onDoubleClick(event: MouseEvent): void {
        if (this.windowControls.available && !this.windowControls.isMac && !(event.target as HTMLElement).closest('button')) {
            this.windowControls.toggleMaximize();
        }
    }
}
