// noinspection CssUnknownTarget

import { NgOptimizedImage } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import type { WorkspaceSummary } from '@shared/models';
import { MessageService, type MenuItem, TooltipOptions } from 'primeng/api';
import { MenuModule } from 'primeng/menu';
import { TooltipModule } from 'primeng/tooltip';
import { ipcErrorMessage } from '../core/bridge/ipc-error';
import { TabsState } from '../core/state/tabs.state';
import { UiState } from '../core/state/ui.state';
import { WindowControlsState } from '../core/state/window-controls.state';
import { WorkspacesState } from '../core/state/workspaces.state';

/**
 * Barra de título própria (a janela não tem moldura nativa): menu da aplicação,
 * workspace, título e controles da janela. A barra arrasta a janela; os botões não.
 */
@Component({
    selector: 'app-title-bar',
    imports: [NgOptimizedImage, MenuModule, TooltipModule],
    template: `
        <div class="app-no-drag flex items-center gap-0.5" [style.padding-left.rem]="windowControls.isMac ? 4.5 : null">
            <button type="button" class="otto-icon-button" [attr.aria-pressed]="ui.sidebarVisible()" aria-label="Toggle sidebar" (click)="ui.toggleSidebar()">
                <i class="pi pi-objects-column" aria-hidden="true"></i>
            </button>
            <!--            <button type="button" class="otto-icon-button" aria-label="Workspace home" pTooltip="Home" tooltipPosition="bottom" (click)="goHome()">-->
            <!--                <i class="pi pi-home" aria-hidden="true"></i>-->
            <!--            </button>-->
        </div>

        <div class="pointer-events-none absolute inset-x-0 mx-auto flex w-fit items-center gap-2 text-sm font-semibold" aria-hidden="true">
            <img ngSrc="favicon.png" width="16" height="16" alt="" />
            Otto
        </div>

        <div class="app-no-drag ml-auto flex items-center gap-0.5">
            <div class="flex items-center gap-1 mr-2">
                <button type="button" class="otto-icon-button w-auto! max-w-64 gap-1.5 px-2!  text-sm font-semibold text-color!" aria-haspopup="menu" [attr.aria-label]="'Workspace: ' + workspaces.activeName()" (click)="workspaceMenu.toggle($event)">
                    <span class="truncate">{{ workspaces.activeName() }}</span>
                    @if (workspaces.busy()) {
                        <i class="pi pi-spin pi-spinner text-xs text-muted-color" aria-hidden="true"></i>
                    } @else {
                        <i class="pi pi-chevron-down text-xs text-muted-color" aria-hidden="true"></i>
                    }
                </button>
                <p-menu #workspaceMenu [model]="workspaceItems()" [popup]="true" [style]="{ minWidth: '16rem' }" />

                @if (windowControls.available && !windowControls.isMac) {
                    <button #menuButton type="button" class="otto-icon-button" aria-label="Application menu" appendTo="body" pTooltip [tooltipOptions]="tooltipMenu" (click)="windowControls.showAppMenu(menuButton)">
                        <i class="pi pi-bars" aria-hidden="true"></i>
                    </button>
                }
            </div>

            @if (windowControls.available && !windowControls.isMac) {
                <span class="mx-1 h-4 w-px bg-surface-200 dark:bg-surface-700" aria-hidden="true"></span>
                <button type="button" class="otto-icon-button w-10!" aria-label="Minimize" (click)="windowControls.minimize()">
                    <i class="pi minimize-icon" aria-hidden="true"></i>
                </button>
                <button type="button" class="otto-icon-button w-10!" [attr.aria-label]="windowControls.maximized() ? 'Restore' : 'Maximize'" (click)="windowControls.toggleMaximize()">
                    <i class="pi text-xs" [class.pi-clone]="windowControls.maximized()" [class.pi-stop]="!windowControls.maximized()" aria-hidden="true"></i>
<!--                    <i class="pi maximize-icon" aria-hidden="true"></i>-->
                </button>
                <button type="button" class="otto-icon-button w-10! hover:bg-red-600! hover:text-white!" aria-label="Close" (click)="windowControls.close()">
                    <i class="pi pi-times text-xs" aria-hidden="true"></i>
                </button>
            }
        </div>
    `,
    host: {
        role: 'banner',
        class: 'app-drag relative flex h-9 shrink-0 items-center border-b border-surface-200 bg-surface-50 px-1.5 dark:border-surface-800 dark:bg-surface-900',
        '(dblclick)': 'onDoubleClick($event)'
    },
    styles: `
        .minimize-icon {
            display: inline-block;
            width: 1rem;
            height: 1rem;
            background-color: currentColor;
            -webkit-mask: url('/assets/icons/minimize.svg') no-repeat center / contain;
            mask: url('/assets/icons/minimize.svg') no-repeat center / contain;
            vertical-align: middle;
        }
        .maximize-icon {
            display: inline-block;
            width: 1rem;
            height: 1rem;
            background-color: currentColor;
            -webkit-mask: url('/assets/icons/maximize.svg') no-repeat center / contain;
            mask: url('/assets/icons/maximize.svg') no-repeat center / contain;
            vertical-align: middle;
        }
    `
})
export class TitleBar {
    protected readonly windowControls = inject(WindowControlsState);
    protected readonly ui = inject(UiState);
    protected readonly workspaces = inject(WorkspacesState);
    private readonly tabs = inject(TabsState);
    private readonly messages = inject(MessageService);

    protected readonly tooltipMenu: TooltipOptions = {
        tooltipLabel: 'Menu',
        positionLeft: 0,
        positionTop: 6,
        tooltipEvent: 'hover',
        tooltipPosition: 'bottom'
        // tooltipZIndex: '99999',
        // appendTo: 'body'
        // tooltipPosition="top"
        // appendTo="body"
    };

    /** Workspaces conhecidos (o ativo marcado) seguidos das ações. */
    protected readonly workspaceItems = computed<MenuItem[]>(() => [
        ...this.workspaces.list().map(
            (workspace, _, all): MenuItem => ({
                // Nomes repetidos (ex.: o mesmo workspace importado duas vezes) ganham a pasta onde estão.
                label: all.filter((w) => w.name === workspace.name).length > 1 && workspace.path ? `${workspace.name} (${workspace.path.split(/[\\/]/).at(-2)})` : workspace.name,
                icon: workspace.missing ? 'pi pi-exclamation-triangle' : workspace.active ? 'pi pi-check' : workspace.path ? 'pi pi-folder' : 'pi pi-desktop',
                title: workspace.missing ? `Folder not found: ${workspace.path}` : (workspace.path ?? 'Local workspace'),
                // Pasta ausente não desabilita: abrir pergunta se remove da lista ou recria.
                command: () => void this.open(workspace)
            })
        ),
        { separator: true },
        { label: 'New Workspace', icon: 'pi pi-plus', command: () => this.ui.newWorkspaceDialog.set(true) },
        { label: 'Import Workspace', icon: 'pi pi-download', command: () => this.ui.importWorkspaceDialog.set(true) },
        { label: 'Manage Workspaces', icon: 'pi pi-cog', command: () => this.tabs.open({ kind: 'workspaces', title: 'Workspaces', collectionId: null }) }
    ]);

    private async open(workspace: WorkspaceSummary): Promise<void> {
        try {
            await this.workspaces.open(workspace);
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not open the workspace', detail: ipcErrorMessage(error), life: 6000 });
        }
    }

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
