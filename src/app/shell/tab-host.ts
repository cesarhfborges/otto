import { Component, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { CollectionOverview } from '../features/collection/collection-overview';
import { RequestView } from '../features/request/request-view';
import { SettingsPage } from '../features/settings/settings.page';
import { EnvironmentsPage } from '../features/environments/environments-page';
import { ManageWorkspaces } from '../features/workspace/manage-workspaces';
import { WorkspaceOverview } from '../features/workspace/workspace-overview';
import { TabsState } from '../core/state/tabs.state';
import { UiState } from '../core/state/ui.state';
import { TAB_PANEL_ID } from './tab-strip';

/** Conteúdo da aba ativa. Cada tipo é carregado sob demanda (`@defer` → chunk separado). */
@Component({
    selector: 'app-tab-host',
    imports: [ButtonModule, ManageWorkspaces, WorkspaceOverview, EnvironmentsPage, SettingsPage, CollectionOverview, RequestView],
    template: `
        @if (tabs.active(); as tab) {
            <div role="tabpanel" [id]="panelId" [attr.aria-labelledby]="'tab-' + tab.id" class="h-full min-h-0 overflow-auto" tabindex="-1">
                @switch (tab.kind) {
                    @case ('overview') {
                        @defer {
                            <app-workspace-overview />
                        }
                    }
                    @case ('environments') {
                        @defer {
                            <app-environments-page [collectionId]="tab.collectionId" />
                        }
                    }
                    @case ('workspaces') {
                        @defer {
                            <app-manage-workspaces />
                        }
                    }
                    @case ('settings') {
                        @defer {
                            <app-settings-page />
                        }
                    }
                    @case ('collection') {
                        @defer {
                            <app-collection-overview [collectionId]="tab.collectionId!" />
                        }
                    }
                    @case ('request') {
                        @defer {
                            <app-request-view [collectionId]="tab.collectionId!" [path]="tab.resourceRef!" />
                        }
                    }
                    @default {
                        <p class="m-0 p-4 text-sm text-muted-color">This tab type is not available yet.</p>
                    }
                }
            </div>
        } @else if (tabs.context(); as collectionId) {
            <div class="flex h-full flex-col items-center justify-center gap-3 text-center">
                <i class="pi pi-send !text-5xl text-surface-300 dark:text-surface-600" aria-hidden="true"></i>
                <p class="m-0 text-sm text-muted-color">No open tabs. Pick a request in the sidebar or create a new one.</p>
                <p-button label="New Request" icon="pi pi-plus" size="small" (onClick)="ui.newRequestDialog.set({ collectionId, folder: '' })" />
            </div>
        }
    `,
    host: { class: 'block min-h-0 flex-1' }
})
export class TabHost {
    protected readonly tabs = inject(TabsState);
    protected readonly ui = inject(UiState);
    protected readonly panelId = TAB_PANEL_ID;
}
