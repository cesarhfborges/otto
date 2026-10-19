import { computed, inject, Injectable, signal } from '@angular/core';
import type { EntityId, TabKind, TabState } from '@shared/models';
import { TabsGateway } from '../ports';

/** O que identifica uma aba: abrir de novo o mesmo recurso só a ativa. */
export interface TabSpec {
    kind: TabKind;
    title: string;
    collectionId: EntityId | null;
    resourceRef?: string | null;
}

/** `null` = workspace (Overview, Environments, Preferences). */
export type TabContext = EntityId | null;

const SAVE_DELAY_MS = 300;

const sameTab = (tab: TabState, spec: TabSpec): boolean => tab.kind === spec.kind && tab.collectionId === spec.collectionId && tab.resourceRef === (spec.resourceRef ?? null);

const newId = (): string => globalThis.crypto?.randomUUID?.() ?? `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Abas abertas, agrupadas por contexto (workspace ou coleção), no estilo do Bruno:
 * a faixa de abas mostra apenas as do contexto atual e cada contexto lembra sua
 * última aba ativa. O conjunto é persistido no SQLite e restaurado ao iniciar.
 */
@Injectable({ providedIn: 'root' })
export class TabsState {
    private readonly gateway = inject(TabsGateway);
    private readonly tabsState = signal<TabState[]>([]);
    private readonly contextState = signal<TabContext>(null);
    /** Última aba ativa de cada contexto (chave `''` = workspace). */
    private readonly activeByContext = signal<Record<string, EntityId>>({});
    private saveTimer: ReturnType<typeof setTimeout> | undefined;
    /** Workspace dono das abas atuais; `null` até a restauração (nada é salvo antes disso). */
    private workspaceId: EntityId | null = null;

    readonly tabs = this.tabsState.asReadonly();
    readonly context = this.contextState.asReadonly();
    readonly visibleTabs = computed(() => this.tabsState().filter((tab) => tab.collectionId === this.contextState()));
    readonly activeId = computed(() => {
        const id = this.activeByContext()[this.contextState() ?? ''];

        return this.visibleTabs().some((tab) => tab.id === id) ? id : (this.visibleTabs()[0]?.id ?? null);
    });
    readonly active = computed(() => this.tabsState().find((tab) => tab.id === this.activeId()) ?? null);

    /**
     * Carrega as abas salvas do workspace, descartando as de coleções que não estão
     * mais nele. Chamado ao iniciar e ao trocar de workspace (após `flush`).
     */
    async restore(workspaceId: EntityId, openCollectionIds: ReadonlySet<EntityId>): Promise<void> {
        clearTimeout(this.saveTimer);
        this.workspaceId = null;
        this.tabsState.set([]);
        this.activeByContext.set({});
        this.contextState.set(null);

        try {
            const saved = (await this.gateway.list(workspaceId)).filter((tab) => tab.collectionId === null || openCollectionIds.has(tab.collectionId));

            this.tabsState.set(saved);
            this.activeByContext.set(Object.fromEntries(saved.map((tab) => [tab.collectionId ?? '', tab.id])));
            this.contextState.set(saved.find((tab) => tab.active)?.collectionId ?? null);

            const active = saved.find((tab) => tab.active);

            if (active) {
                this.activeByContext.update((map) => ({ ...map, [active.collectionId ?? '']: active.id }));
            }
        } catch {
            // Fora do Electron não há persistência.
        }

        this.workspaceId = workspaceId;
        this.ensureWorkspaceTab();
    }

    /** Grava imediatamente o que estiver pendente (antes de trocar de workspace). */
    async flush(): Promise<void> {
        clearTimeout(this.saveTimer);
        await this.save();
    }

    open(spec: TabSpec): TabState {
        const existing = this.tabsState().find((tab) => sameTab(tab, spec));

        if (existing) {
            this.activate(existing.id);

            return existing;
        }

        const tab: TabState = { id: newId(), kind: spec.kind, title: spec.title, collectionId: spec.collectionId, resourceRef: spec.resourceRef ?? null, position: 0, active: false, draft: null };
        const activeIndex = this.tabsState().findIndex((t) => t.id === this.activeId());

        // Nova aba entra logo após a ativa, como em navegadores e editores.
        this.tabsState.update((tabs) => (activeIndex >= 0 && tabs[activeIndex]?.collectionId === spec.collectionId ? [...tabs.slice(0, activeIndex + 1), tab, ...tabs.slice(activeIndex + 1)] : [...tabs, tab]));
        this.activate(tab.id);

        return tab;
    }

    activate(id: EntityId): void {
        const tab = this.tabsState().find((t) => t.id === id);

        if (!tab) {
            return;
        }

        this.contextState.set(tab.collectionId);
        this.activeByContext.update((map) => ({ ...map, [tab.collectionId ?? '']: id }));
        this.scheduleSave();
    }

    /** Troca de contexto; o workspace nunca fica vazio (abre o Overview). */
    setContext(context: TabContext): void {
        this.contextState.set(context);
        this.ensureWorkspaceTab();
        this.scheduleSave();
    }

    close(id: EntityId): void {
        const tabs = this.tabsState();
        const index = tabs.findIndex((t) => t.id === id);
        const tab = tabs[index];

        if (!tab) {
            return;
        }

        const siblings = tabs.filter((t) => t.collectionId === tab.collectionId);
        const position = siblings.findIndex((t) => t.id === id);
        const neighbor = siblings[position + 1] ?? siblings[position - 1];

        this.tabsState.set(tabs.filter((t) => t.id !== id));

        if (this.activeByContext()[tab.collectionId ?? ''] === id && neighbor) {
            this.activeByContext.update((map) => ({ ...map, [tab.collectionId ?? '']: neighbor.id }));
        }

        this.ensureWorkspaceTab();
        this.scheduleSave();
    }

    closeOthers(id: EntityId): void {
        const tab = this.tabsState().find((t) => t.id === id);

        if (tab) {
            this.tabsState.update((tabs) => tabs.filter((t) => t.collectionId !== tab.collectionId || t.id === id));
            this.activate(id);
        }
    }

    /** Ao fechar uma coleção, suas abas somem e o contexto volta ao workspace. */
    closeCollection(collectionId: EntityId): void {
        this.tabsState.update((tabs) => tabs.filter((t) => t.collectionId !== collectionId));

        if (this.contextState() === collectionId) {
            this.setContext(null);
        }

        this.scheduleSave();
    }

    /** Atualiza título/recurso de abas (ex.: requisição renomeada ou movida). */
    update(id: EntityId, changes: Partial<Pick<TabState, 'title' | 'resourceRef'>>): void {
        this.tabsState.update((tabs) => tabs.map((t) => (t.id === id ? { ...t, ...changes } : t)));
        this.scheduleSave();
    }

    private ensureWorkspaceTab(): void {
        if (this.contextState() === null && !this.tabsState().some((t) => t.collectionId === null)) {
            this.open({ kind: 'overview', title: 'Overview', collectionId: null });
        }
    }

    private scheduleSave(): void {
        if (this.workspaceId === null) {
            return;
        }

        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => void this.save(), SAVE_DELAY_MS);
    }

    private async save(): Promise<void> {
        const workspaceId = this.workspaceId;

        if (workspaceId === null) {
            return;
        }

        const activeId = this.activeId();
        const tabs = this.tabsState().map((tab, position) => ({ ...tab, position, active: tab.id === activeId }));

        await this.gateway.save(workspaceId, tabs).catch((error: unknown) => console.warn('[otto] failed to save tabs', error));
    }
}
