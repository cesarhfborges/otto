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

/** `null` = workspace (Overview, Environments). */
export type TabContext = EntityId | null;

const SAVE_DELAY_MS = 300;

/** Quantas abas fechadas podem ser reabertas (`Mod+Shift+T`). */
const MAX_CLOSED_TABS = 20;

const sameTab = (tab: TabState, spec: TabSpec): boolean => tab.kind === spec.kind && tab.collectionId === spec.collectionId && tab.resourceRef === (spec.resourceRef ?? null);

/**
 * O Overview do workspace é uma aba fixa: a "home" do workspace, sempre a primeira da faixa,
 * sem fechar nem mover. Garante que o contexto do workspace nunca fique vazio.
 */
export const isPinnedTab = (tab: Pick<TabState, 'kind' | 'collectionId'>): boolean => tab.kind === 'overview' && tab.collectionId === null;

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
    /** Pergunta antes de fechar (ex.: requisição com alterações não salvas). */
    private closeGuard: ((tab: TabState) => boolean | Promise<boolean>) | null = null;
    /** Workspace dono das abas atuais; `null` até a restauração (nada é salvo antes disso). */
    private workspaceId: EntityId | null = null;
    /** Abas fechadas pelo usuário, da mais recente para a mais antiga. */
    private readonly closedState = signal<TabSpec[]>([]);

    readonly tabs = this.tabsState.asReadonly();
    readonly context = this.contextState.asReadonly();
    readonly visibleTabs = computed(() => this.tabsState().filter((tab) => tab.collectionId === this.contextState()));
    readonly activeId = computed(() => {
        const id = this.activeByContext()[this.contextState() ?? ''];

        return this.visibleTabs().some((tab) => tab.id === id) ? id : (this.visibleTabs()[0]?.id ?? null);
    });
    readonly active = computed(() => this.tabsState().find((tab) => tab.id === this.activeId()) ?? null);
    readonly canReopen = computed(() => this.closedState().length > 0);

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
        this.closedState.set([]);

        try {
            // Preferences virou modal (`SettingsDialog`): abas `settings` salvas por versões antigas são descartadas.
            const saved = (await this.gateway.list(workspaceId)).filter((tab) => tab.kind !== 'settings' && (tab.collectionId === null || openCollectionIds.has(tab.collectionId)));

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
        this.ensurePinnedTab();
        this.scheduleSave();
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

    /** Troca de contexto; o workspace nunca fica vazio (tem sempre o Overview fixo). */
    setContext(context: TabContext): void {
        this.contextState.set(context);
        this.ensurePinnedTab();
        this.scheduleSave();
    }

    /** Entra na coleção: volta à última aba dela ou, se não houver nenhuma, abre o Overview. */
    enterCollection(collectionId: EntityId): void {
        this.setContext(collectionId);

        if (!this.visibleTabs().length) {
            this.open({ kind: 'collection', title: 'Overview', collectionId });
        }
    }

    setCloseGuard(guard: (tab: TabState) => boolean | Promise<boolean>): void {
        this.closeGuard = guard;
    }

    /** Fecha a aba, consultando antes o guard (que pode pedir confirmação). A aba fixa não fecha. */
    close(id: EntityId): void {
        const tab = this.tabsState().find((t) => t.id === id);

        if (!tab || isPinnedTab(tab)) {
            return;
        }

        if (!this.closeGuard) {
            this.remove(id);

            return;
        }

        void Promise.resolve(this.closeGuard(tab)).then((allowed) => allowed && this.remove(id));
    }

    private remove(id: EntityId): void {
        const tabs = this.tabsState();
        const index = tabs.findIndex((t) => t.id === id);
        const tab = tabs[index];

        if (!tab || isPinnedTab(tab)) {
            return;
        }

        const siblings = tabs.filter((t) => t.collectionId === tab.collectionId);
        const position = siblings.findIndex((t) => t.id === id);
        const neighbor = siblings[position + 1] ?? siblings[position - 1];

        this.tabsState.set(tabs.filter((t) => t.id !== id));
        this.closedState.update((closed) => [{ kind: tab.kind, title: tab.title, collectionId: tab.collectionId, resourceRef: tab.resourceRef }, ...closed].slice(0, MAX_CLOSED_TABS));

        if (this.activeByContext()[tab.collectionId ?? ''] === id && neighbor) {
            this.activeByContext.update((map) => ({ ...map, [tab.collectionId ?? '']: neighbor.id }));
        }

        this.scheduleSave();
    }

    /** Fecha as demais abas do contexto (menos a fixa), uma a uma (cada uma pode pedir confirmação). */
    async closeOthers(id: EntityId): Promise<void> {
        const tab = this.tabsState().find((t) => t.id === id);

        if (!tab) {
            return;
        }

        this.activate(id);

        for (const other of this.tabsState().filter((t) => t.collectionId === tab.collectionId && t.id !== id && !isPinnedTab(t))) {
            if (!this.closeGuard || (await this.closeGuard(other))) {
                this.remove(other.id);
            }
        }
    }

    /** Fecha todas as abas do contexto atual (menos a fixa), uma a uma (cada uma pode pedir confirmação). */
    async closeAll(): Promise<void> {
        for (const tab of this.visibleTabs().filter((t) => !isPinnedTab(t))) {
            if (!this.closeGuard || (await this.closeGuard(tab))) {
                this.remove(tab.id);
            }
        }
    }

    /** Reabre a última aba fechada (as de coleções fechadas já saíram da pilha em `closeCollection`). */
    reopenClosed(): void {
        const [spec, ...rest] = this.closedState();

        if (spec) {
            this.closedState.set(rest);
            this.open(spec);
        }
    }

    /** Move a aba uma posição entre as do mesmo contexto (`delta` = -1 ou 1). */
    move(id: EntityId, delta: -1 | 1): void {
        const tab = this.tabsState().find((t) => t.id === id);
        const index = this.tabsState()
            .filter((t) => t.collectionId === tab?.collectionId)
            .findIndex((t) => t.id === id);

        if (index >= 0) {
            this.moveTo(id, index + delta);
        }
    }

    /**
     * Leva a aba para `index` entre as abas do mesmo contexto (a ordem da faixa, como no
     * arrastar e soltar). O array global intercala contextos: a aba entra antes da irmã que
     * ocupa o destino, ou logo após a última irmã quando o destino é o fim. A aba fixa não
     * sai do lugar e nenhuma outra passa à frente dela.
     */
    moveTo(id: EntityId, index: number): void {
        const tabs = this.tabsState();
        const tab = tabs.find((t) => t.id === id);

        if (!tab || isPinnedTab(tab)) {
            return;
        }

        const current = tabs.filter((t) => t.collectionId === tab.collectionId).findIndex((t) => t.id === id);
        const rest = tabs.filter((t) => t.id !== id);
        const siblings = rest.filter((t) => t.collectionId === tab.collectionId);
        const target = Math.max(siblings.filter(isPinnedTab).length, Math.min(index, siblings.length));

        if (target === current) {
            return;
        }

        const before = siblings[target];
        const last = siblings[siblings.length - 1];
        const at = before ? rest.indexOf(before) : last ? rest.indexOf(last) + 1 : rest.length;

        this.tabsState.set([...rest.slice(0, at), tab, ...rest.slice(at)]);
        this.scheduleSave();
    }

    /** Ao fechar uma coleção, suas abas somem e o contexto volta ao workspace. */
    closeCollection(collectionId: EntityId): void {
        this.tabsState.update((tabs) => tabs.filter((t) => t.collectionId !== collectionId));
        this.closedState.update((closed) => closed.filter((spec) => spec.collectionId !== collectionId));

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

    /**
     * Garante o Overview fixo como primeira aba do workspace (inclusive em abas salvas por versões
     * antigas, em que ele podia ter sido fechado ou movido). Não o ativa: sem outra aba ativa no
     * workspace, `activeId` já recai sobre a primeira.
     */
    private ensurePinnedTab(): void {
        const tabs = this.tabsState();
        const pinned = tabs.find(isPinnedTab);

        if (!pinned) {
            this.tabsState.set([{ id: newId(), kind: 'overview', title: 'Overview', collectionId: null, resourceRef: null, position: 0, active: false, draft: null }, ...tabs]);
        } else if (tabs.find((t) => t.collectionId === null) !== pinned) {
            this.tabsState.set([pinned, ...tabs.filter((t) => t !== pinned)]);
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
