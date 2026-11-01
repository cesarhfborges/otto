import { inject, Injectable, signal } from '@angular/core';
import type { EntityId, ScriptInventory, ScriptPermissions, ScriptPhaseName, ScriptPolicy, ScriptPolicyPatch } from '@shared/models';
import { CollectionsGateway } from '../ports';
import { CollectionsState } from '../state/collections.state';
import { ConfirmState } from '../state/confirm.state';
import { TabsState } from '../state/tabs.state';
import { UiState } from '../state/ui.state';

/**
 * Estado efetivo dos scripts de uma coleção:
 * - `none`: sem scripts;
 * - `trusted`: confiáveis e iguais aos de quando a confiança foi dada;
 * - `changed`: confiáveis, mas alterados/criados/removidos desde então (volta a perguntar);
 * - `ask`: pergunta antes de rodar; `session`/`refused`: decisão desta sessão;
 * - `disabled`: nunca rodam (as requisições saem sem eles).
 */
export type ScriptSecurityStatus = 'none' | 'trusted' | 'changed' | 'ask' | 'session' | 'refused' | 'disabled';

export type ScriptActivityResult = 'ok' | 'error' | 'stopped' | 'blocked' | 'skipped';

/** Uma execução de script (só em memória, como o histórico). */
export interface ScriptActivity {
    id: number;
    at: Date;
    path: string;
    requestName: string;
    phase: ScriptPhaseName;
    /** De onde vem o script herdado (`collection`, `folder api`); `null` = da própria requisição. */
    origin: string | null;
    durationMs: number | null;
    result: ScriptActivityResult;
    message: string | null;
}

export interface ScriptRunDecision {
    run: boolean;
    permissions: ScriptPermissions;
    /** Por que não roda: `disabled` envia sem os scripts; `refused` não envia. */
    reason: 'disabled' | 'refused' | null;
}

const MAX_ACTIVITY = 50;
/** Antes de rodar, o inventário é relido se tiver mais que isso (pega um `git pull` recente). */
const FRESH_MS = 1_000;
const REFRESH_DELAY_MS = 300;

const PERMISSION_LABELS: Record<keyof ScriptPermissions, string> = {
    modifyRequest: 'Change the request being sent',
    writeVariables: 'Write environment and collection variables',
    writeCookies: 'Change cookies',
    sendRequests: 'Send other requests of the collection',
    readSecrets: 'Read secret variables'
};

export const scriptPermissionLabel = (permission: keyof ScriptPermissions): string => PERMISSION_LABELS[permission];

/**
 * Política de segurança dos scripts por coleção (modo, permissões, confiança presa ao
 * conteúdo), decisões desta sessão, inventário e atividade recente do sandbox.
 */
@Injectable({ providedIn: 'root' })
export class ScriptSecurityState {
    private readonly collections = inject(CollectionsState);
    private readonly gateway = inject(CollectionsGateway);
    private readonly confirm = inject(ConfirmState);
    private readonly tabs = inject(TabsState);
    private readonly ui = inject(UiState);

    private readonly inventories = signal<ReadonlyMap<EntityId, ScriptInventory>>(new Map());
    private readonly sessionState = signal<ReadonlyMap<EntityId, 'session' | 'refused'>>(new Map());
    private readonly activityState = signal<ReadonlyMap<EntityId, readonly ScriptActivity[]>>(new Map());
    private readonly problemState = signal<ReadonlyMap<EntityId, string>>(new Map());
    private readonly loadedAt = new Map<EntityId, number>();
    private readonly loading = new Map<EntityId, Promise<ScriptInventory | null>>();
    private readonly asking = new Map<EntityId, Promise<boolean>>();
    private readonly timers = new Map<EntityId, ReturnType<typeof setTimeout>>();
    private nextActivityId = 1;

    /** Script em execução agora (indicador da barra de status). */
    readonly running = signal<{ collectionId: EntityId; requestName: string; phase: ScriptPhaseName } | null>(null);

    constructor() {
        // Mudanças no disco (git pull, editor, o próprio app) podem mudar os scripts.
        this.gateway.onChanged(({ collectionId }) => this.scheduleRefresh(collectionId));
    }

    policy(collectionId: EntityId | null): ScriptPolicy | null {
        return this.collections.find(collectionId)?.metadata.scriptPolicy ?? null;
    }

    /** Inventário já carregado (lê signals); `ensure` dispara a carga. */
    inventory(collectionId: EntityId | null): ScriptInventory | null {
        return collectionId ? (this.inventories().get(collectionId) ?? null) : null;
    }

    ensure(collectionId: EntityId): void {
        if (!this.loadedAt.has(collectionId) && !this.loading.has(collectionId)) {
            void this.refresh(collectionId);
        }
    }

    async refresh(collectionId: EntityId): Promise<ScriptInventory | null> {
        const pending = this.loading.get(collectionId);

        if (pending) {
            return pending;
        }

        const load = (async () => {
            try {
                const inventory = await this.gateway.scriptInventory(collectionId);
                const collection = this.collections.find(collectionId);

                this.loadedAt.set(collectionId, Date.now());
                this.inventories.update((map) => new Map(map).set(collectionId, inventory));

                // O main pode ter adotado a impressão digital (coleção já confiável).
                if (collection && JSON.stringify(collection.metadata.scriptPolicy) !== JSON.stringify(inventory.policy)) {
                    this.collections.replaceMetadata({ ...collection.metadata, scriptPolicy: inventory.policy });
                }

                return inventory;
            } catch {
                return null;
            } finally {
                this.loading.delete(collectionId);
            }
        })();

        this.loading.set(collectionId, load);

        return load;
    }

    status(collectionId: EntityId | null): ScriptSecurityStatus {
        const policy = this.policy(collectionId);
        const inventory = this.inventory(collectionId);

        if (!collectionId || !policy || !inventory || !inventory.entries.length) {
            return 'none';
        }

        switch (policy.mode) {
            case 'disabled':
                return 'disabled';
            case 'trusted':
                return this.changes(collectionId) ? 'changed' : 'trusted';
            default:
                return this.sessionState().get(collectionId) ?? 'ask';
        }
    }

    /** Scripts alterados, criados ou removidos desde a confiança. */
    changes(collectionId: EntityId | null): number {
        const inventory = this.inventory(collectionId);
        const policy = this.policy(collectionId);

        if (!inventory || policy?.mode !== 'trusted') {
            return 0;
        }

        const changed = inventory.entries.filter((entry) => entry.trust !== 'same').length + inventory.removed.length;

        return changed || (policy.trustedFingerprint && policy.trustedFingerprint !== inventory.fingerprint ? 1 : 0);
    }

    activity(collectionId: EntityId | null): readonly ScriptActivity[] {
        return collectionId ? (this.activityState().get(collectionId) ?? []) : [];
    }

    /** Último script interrompido pelo sandbox ou pela política (some no próximo que rodar bem). */
    problem(collectionId: EntityId | null): string | null {
        return collectionId ? (this.problemState().get(collectionId) ?? null) : null;
    }

    sessionDecision(collectionId: EntityId | null): 'session' | 'refused' | null {
        return collectionId ? (this.sessionState().get(collectionId) ?? null) : null;
    }

    /** Decide se os scripts rodam (perguntando se preciso) e com quais permissões. */
    async allowed(collectionId: EntityId): Promise<ScriptRunDecision> {
        const collection = this.collections.find(collectionId);

        if (!collection) {
            return { run: true, permissions: { modifyRequest: true, writeVariables: true, writeCookies: true, sendRequests: true, readSecrets: true }, reason: null };
        }

        // Relê o inventário antes de rodar: scripts confiados podem ter mudado há pouco.
        if (Date.now() - (this.loadedAt.get(collectionId) ?? 0) > FRESH_MS) {
            await this.refresh(collectionId);
        }

        const status = this.status(collectionId);
        const decision = (run: boolean, reason: ScriptRunDecision['reason'] = null): ScriptRunDecision => ({ run, reason, permissions: this.policy(collectionId)?.permissions ?? collection.metadata.scriptPolicy.permissions });

        switch (status) {
            case 'disabled':
                return decision(false, 'disabled');
            case 'refused':
                return decision(false, 'refused');
            case 'ask':
            case 'changed':
                return (await this.ask(collectionId, status)) ? decision(true) : decision(false, 'refused');
            default:
                return decision(true);
        }
    }

    async setPolicy(collectionId: EntityId, patch: ScriptPolicyPatch): Promise<void> {
        const metadata = await this.gateway.setScriptPolicy(collectionId, patch);

        this.collections.replaceMetadata(metadata);
        this.forgetSession(collectionId);
        await this.refresh(collectionId);
    }

    /** Confia no conteúdo atual dos scripts (mantendo as permissões). */
    trustCurrent(collectionId: EntityId): Promise<void> {
        const policy = this.policy(collectionId);

        return this.setPolicy(collectionId, { mode: 'trusted', permissions: policy?.customPermissions ? policy.permissions : null, retrust: true });
    }

    /** Esquece a decisão desta sessão (e o último aviso de script parado, que dependia dela). */
    forgetSession(collectionId: EntityId): void {
        this.problemState.update((map) => {
            const next = new Map(map);

            next.delete(collectionId);

            return next;
        });
        this.sessionState.update((map) => {
            const next = new Map(map);

            next.delete(collectionId);

            return next;
        });
    }

    record(collectionId: EntityId, activity: Omit<ScriptActivity, 'id'>): void {
        const entry = { ...activity, id: this.nextActivityId++ };

        this.activityState.update((map) => new Map(map).set(collectionId, [entry, ...(map.get(collectionId) ?? [])].slice(0, MAX_ACTIVITY)));
        this.problemState.update((map) => {
            const next = new Map(map);

            if (activity.result === 'stopped' || activity.result === 'blocked') {
                next.set(collectionId, activity.message ?? 'A script was stopped');
            } else if (activity.result === 'ok') {
                next.delete(collectionId);
            }

            return next;
        });
    }

    /** Abre a página da coleção na aba Security. */
    openSecurity(collectionId: EntityId): void {
        this.ui.collectionSection.set({ collectionId, section: 'security' });
        this.tabs.open({ kind: 'collection', title: 'Overview', collectionId });
    }

    private scheduleRefresh(collectionId: EntityId): void {
        if (!this.loadedAt.has(collectionId)) {
            return;
        }

        clearTimeout(this.timers.get(collectionId));
        this.timers.set(
            collectionId,
            setTimeout(() => {
                this.timers.delete(collectionId);
                void this.refresh(collectionId);
            }, REFRESH_DELAY_MS)
        );
    }

    /** Uma única pergunta por coleção, mesmo com vários scripts no mesmo envio. */
    private ask(collectionId: EntityId, status: 'ask' | 'changed'): Promise<boolean> {
        let pending = this.asking.get(collectionId);

        if (!pending) {
            pending = (status === 'changed' ? this.askChanged(collectionId) : this.askUntrusted(collectionId)).finally(() => this.asking.delete(collectionId));
            this.asking.set(collectionId, pending);
        }

        return pending;
    }

    private async askUntrusted(collectionId: EntityId): Promise<boolean> {
        const name = this.collections.find(collectionId)?.manifest.name ?? 'This collection';
        const count = this.inventory(collectionId)?.entries.length ?? 0;
        const answer = await this.confirm.choose({
            header: 'Run Scripts?',
            message: `"${name}" has ${count} script${count === 1 ? '' : 's'} that run when you send requests. This collection came from outside this app (an import or a folder from Git), so its scripts have not been reviewed.`,
            detail: 'Scripts run in an isolated sandbox, limited by the permissions in the collection’s Security tab. Only trust collections from sources you know.',
            acceptLabel: 'Trust Collection',
            acceptIcon: 'pi pi-shield',
            alternativeLabel: 'Allow Until Restart',
            rejectLabel: "Don't Run",
            severity: 'warn',
            icon: 'pi pi-exclamation-triangle'
        });

        return this.applyAnswer(collectionId, answer, () => this.setPolicy(collectionId, { mode: 'trusted', permissions: null }));
    }

    private async askChanged(collectionId: EntityId): Promise<boolean> {
        const name = this.collections.find(collectionId)?.manifest.name ?? 'This collection';
        const inventory = this.inventory(collectionId);
        const changed = [...(inventory?.entries.filter((entry) => entry.trust !== 'same').map((entry) => `${entry.name} (${entry.trust === 'new' ? 'new' : 'changed'})`) ?? []), ...(inventory?.removed.map((entry) => `${entry.name} (removed)`) ?? [])];
        const list = changed.slice(0, 5).join(', ') + (changed.length > 5 ? ` and ${changed.length - 5} more` : '');
        const answer = await this.confirm.choose({
            header: 'Scripts Changed',
            message: `${changed.length || 'Some'} script${changed.length === 1 ? '' : 's'} of "${name}" changed since you trusted them${list ? `: ${list}` : ''}.`,
            detail: 'They may have come from a Git pull or another editor. Review the differences in the collection’s Security tab before trusting them again.',
            acceptLabel: 'Trust Current Scripts',
            acceptIcon: 'pi pi-shield',
            alternativeLabel: 'Allow Until Restart',
            rejectLabel: "Don't Run",
            severity: 'warn',
            icon: 'pi pi-exclamation-triangle'
        });

        return this.applyAnswer(collectionId, answer, () => this.trustCurrent(collectionId));
    }

    private async applyAnswer(collectionId: EntityId, answer: 'accept' | 'alternative' | 'cancel', trust: () => Promise<void>): Promise<boolean> {
        if (answer === 'accept') {
            await trust();

            return true;
        }

        this.sessionState.update((map) => new Map(map).set(collectionId, answer === 'alternative' ? 'session' : 'refused'));

        return answer === 'alternative';
    }
}
