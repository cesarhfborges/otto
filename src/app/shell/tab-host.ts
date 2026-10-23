import { afterNextRender, Component, computed, DestroyRef, effect, type ElementRef, type EmbeddedViewRef, inject, Injector, linkedSignal, type Signal, type TemplateRef, untracked, viewChild, ViewContainerRef } from '@angular/core';
import type { EntityId, TabState } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { CollectionOverview } from '../features/collection/collection-overview';
import { RequestView } from '../features/request/request-view';
import { EnvironmentsPage } from '../features/environments/environments-page';
import { ManageWorkspaces } from '../features/workspace/manage-workspaces';
import { WorkspaceOverview } from '../features/workspace/workspace-overview';
import { TabsState } from '../core/state/tabs.state';
import { UiState } from '../core/state/ui.state';
import { TAB_ACTIVE } from './tab-active';
import { TAB_PANEL_ID } from './tab-strip';

/** Abas mantidas vivas em segundo plano; acima disso a usada há mais tempo é desmontada (continua aberta). */
const MAX_MOUNTED_TABS = 15;

interface PanelContext {
    $implicit: Signal<TabState | undefined>;
}

/**
 * Conteúdo da aba ativa. Cada aba visitada ganha sua própria view, que continua viva
 * ao trocar de aba: só o DOM da ativa fica no documento (as demais ficam desanexadas,
 * sem IDs duplicados nem change detection), e voltar a ela não recria nada.
 * Cada tipo é carregado sob demanda (`@defer` → chunk separado).
 */
@Component({
    selector: 'app-tab-host',
    imports: [ButtonModule, ManageWorkspaces, WorkspaceOverview, EnvironmentsPage, CollectionOverview, RequestView],
    template: `
        <ng-template #panel let-tab>
            @if (tab(); as tab) {
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
            }
        </ng-template>

        <div #container role="tabpanel" [id]="panelId" [attr.aria-labelledby]="tabs.activeId() ? 'tab-' + tabs.activeId() : null" [hidden]="!tabs.active()" class="h-full min-h-0 overflow-auto" tabindex="-1">
            <ng-container #outlet />
        </div>

        @if (!tabs.active()) {
            @if (tabs.context(); as collectionId) {
                <div class="flex h-full flex-col items-center justify-center gap-3 text-center">
                    <i class="pi pi-send !text-5xl text-surface-300 dark:text-surface-600" aria-hidden="true"></i>
                    <p class="m-0 text-sm text-muted-color select-none">No open tabs. Pick a request in the sidebar or create a new one.</p>
                    <p-button label="New Request" icon="pi pi-plus" size="small" (onClick)="ui.newRequestDialog.set({ collectionId, folder: '' })" />
                </div>
            }
        }
    `,
    host: { class: 'block min-h-0 flex-1' }
})
export class TabHost {
    protected readonly tabs = inject(TabsState);
    protected readonly ui = inject(UiState);
    protected readonly panelId = TAB_PANEL_ID;

    private readonly injector = inject(Injector);
    private readonly panel = viewChild.required<TemplateRef<PanelContext>>('panel');
    private readonly outlet = viewChild.required('outlet', { read: ViewContainerRef });
    private readonly container = viewChild.required<ElementRef<HTMLElement>>('container');
    private readonly views = new Map<EntityId, EmbeddedViewRef<PanelContext>>();
    /** Rolagem do painel de cada aba (o DOM desanexado não guarda `scrollTop`). */
    private readonly scrollTops = new Map<EntityId, number>();
    private shown: EntityId | null = null;

    /** Abas montadas, da usada mais recentemente para a mais antiga; as fechadas saem. */
    private readonly mounted = linkedSignal<{ active: EntityId | null; open: ReadonlySet<EntityId> }, EntityId[]>({
        source: () => ({ active: this.tabs.activeId(), open: new Set(this.tabs.tabs().map((tab) => tab.id)) }),
        computation: ({ active, open }, previous) => {
            const kept = (previous?.value ?? []).filter((id) => open.has(id) && id !== active);

            return (active ? [active, ...kept] : kept).slice(0, MAX_MOUNTED_TABS);
        }
    });

    constructor() {
        effect(() => {
            const mounted = this.mounted();
            const active = this.tabs.activeId();
            const template = this.panel();
            const outlet = this.outlet();

            untracked(() => this.sync(template, outlet, new Set(mounted), active));
        });

        inject(DestroyRef).onDestroy(() => {
            for (const view of this.views.values()) {
                view.destroy();
            }
        });
    }

    private sync(template: TemplateRef<PanelContext>, outlet: ViewContainerRef, mounted: ReadonlySet<EntityId>, active: EntityId | null): void {
        for (const [id, view] of this.views) {
            if (!mounted.has(id)) {
                view.destroy();
                this.views.delete(id);
                this.scrollTops.delete(id);
            }
        }

        const element = this.container().nativeElement;
        const previous = this.shown === null ? undefined : this.views.get(this.shown);

        if (this.shown === active && (active === null || previous)) {
            return;
        }

        if (previous) {
            this.scrollTops.set(this.shown!, element.scrollTop);
            outlet.detach(outlet.indexOf(previous));
        }

        this.shown = active;

        if (active === null) {
            return;
        }

        const view = this.views.get(active);

        if (view) {
            outlet.insert(view);
        } else {
            this.views.set(active, outlet.createEmbeddedView(template, { $implicit: computed(() => this.tabs.tabs().find((tab) => tab.id === active)) }, { injector: this.panelInjector(active) }));
        }

        const scrollTop = this.scrollTops.get(active) ?? 0;

        afterNextRender(() => (element.scrollTop = scrollTop), { injector: this.injector });
    }

    private panelInjector(id: EntityId): Injector {
        return Injector.create({ providers: [{ provide: TAB_ACTIVE, useValue: computed(() => this.tabs.activeId() === id) }], parent: this.injector });
    }
}
