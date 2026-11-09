import { inject, Injectable, signal } from '@angular/core';
import { defaultScriptPermissions, type EntityId, type ScriptInventory, type ScriptPermissions, type ScriptPhaseName, type ScriptPolicy, type ScriptPolicyPatch } from '@shared/models';
import { CollectionsGateway } from '../ports';
import { CollectionsState } from '../state/collections.state';
import { ConfirmState } from '../state/confirm.state';
import { TabsState } from '../state/tabs.state';
import { UiState } from '../state/ui.state';

/**
 * Estado efetivo dos scripts de uma coleção:
 * - `none`: sem scripts;
 * - `trusted`: confiáveis e iguais aos de quando a confiança foi dada (ou editados no app);
 * - `changed`: confiáveis, mas alterados fora do app desde então (pergunta antes de rodar);
 * - `ask`: pergunta antes de rodar;
 * - `session`: liberados até o Otto reiniciar (ou até os scripts mudarem);
 * - `blocked`: nunca rodam (as requisições saem sem eles).
 */
export type ScriptSecurityStatus = 'none' | 'trusted' | 'changed' | 'ask' | 'session' | 'blocked';

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

/** `run`: roda os scripts; `skip`: envia sem eles (Blocked); `cancel`: não envia (pergunta cancelada). */
export type ScriptRunAction = 'run' | 'skip' | 'cancel';

export interface ScriptRunDecision {
    action: ScriptRunAction;
    permissions: ScriptPermissions;
}

const MAX_ACTIVITY = 50;
/** Antes de rodar, o inventário é relido se tiver mais que isso (pega um `git pull` recente). */
const FRESH_MS = 1_000;
const REFRESH_DELAY_MS = 300;

export { scriptPermissionLabel } from './script-api';

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
    /** "Allow This Session": vale para os scripts com esta impressão digital. */
    private readonly sessionState = signal<ReadonlyMap<EntityId, string>>(new Map());
    private readonly activityState = signal<ReadonlyMap<EntityId, readonly ScriptActivity[]>>(new Map());
    private readonly problemState = signal<ReadonlyMap<EntityId, string>>(new Map());
    private readonly loadedAt = new Map<EntityId, number>();
    private readonly loading = new Map<EntityId, Promise<ScriptInventory | null>>();
    private readonly asking = new Map<EntityId, Promise<ScriptRunAction>>();
    /** Decisão do envio em andamento (vale para a cadeia, o post-response e envios aninhados). */
    private readonly activeSends = new Map<EntityId, { decision: ScriptRunDecision; count: number }>();
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

        if (policy.mode === 'disabled') {
            return 'blocked';
        }

        if (policy.mode === 'trusted' && !this.changes(collectionId)) {
            return 'trusted';
        }

        if (this.sessionState().get(collectionId) === inventory.fingerprint) {
            return 'session';
        }

        return policy.mode === 'trusted' ? 'changed' : 'ask';
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

    hasSessionDecision(collectionId: EntityId | null): boolean {
        return !!collectionId && this.sessionState().has(collectionId);
    }

    /**
     * Decide uma vez por envio se os scripts rodam (perguntando se preciso) e com quais
     * permissões. Envios aninhados (`otto.request('…')`) durante um envio reaproveitam a
     * decisão. Sempre chamar `endSend` depois.
     */
    async beginSend(collectionId: EntityId): Promise<ScriptRunDecision> {
        const active = this.activeSends.get(collectionId);

        if (active) {
            active.count++;

            return active.decision;
        }

        const entry = { decision: { action: 'cancel' as ScriptRunAction, permissions: defaultScriptPermissions() }, count: 1 };

        this.activeSends.set(collectionId, entry);

        try {
            entry.decision = await this.decide(collectionId);
        } catch (error) {
            this.endSend(collectionId);

            throw error;
        }

        return entry.decision;
    }

    endSend(collectionId: EntityId): void {
        const active = this.activeSends.get(collectionId);

        if (active && --active.count <= 0) {
            this.activeSends.delete(collectionId);
        }
    }

    private async decide(collectionId: EntityId): Promise<ScriptRunDecision> {
        const collection = this.collections.find(collectionId);

        if (!collection) {
            return { action: 'run', permissions: defaultScriptPermissions() };
        }

        // Relê o inventário antes de rodar: scripts confiados podem ter mudado há pouco.
        if (Date.now() - (this.loadedAt.get(collectionId) ?? 0) > FRESH_MS) {
            await this.refresh(collectionId);
        }

        const policy = this.policy(collectionId) ?? collection.metadata.scriptPolicy;
        const permissions = policy.permissions;
        let status = this.status(collectionId);

        // Sem scripts no disco (ex.: script digitado e ainda não salvo): vale o modo da coleção.
        if (status === 'none') {
            const session = this.sessionState().get(collectionId);

            status = policy.mode === 'disabled' ? 'blocked' : policy.mode === 'trusted' ? 'trusted' : session !== undefined && session === this.inventory(collectionId)?.fingerprint ? 'session' : 'ask';
        }

        switch (status) {
            case 'blocked':
                return { action: 'skip', permissions };
            case 'ask':
            case 'changed':
                return { action: await this.ask(collectionId, status), permissions };
            default:
                return { action: 'run', permissions };
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

    /** Esquece o "Allow This Session" (volta a perguntar) e o último aviso de script parado. */
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

    /** Uma única pergunta por coleção, mesmo com vários envios ao mesmo tempo. */
    private ask(collectionId: EntityId, status: 'ask' | 'changed'): Promise<ScriptRunAction> {
        let pending = this.asking.get(collectionId);

        if (!pending) {
            pending = this.askToRun(collectionId, status).finally(() => this.asking.delete(collectionId));
            this.asking.set(collectionId, pending);
        }

        return pending;
    }

    /** Allow Once (só este envio), Allow This Session (até reiniciar ou os scripts mudarem) ou Cancel (não envia). */
    private async askToRun(collectionId: EntityId, status: 'ask' | 'changed'): Promise<ScriptRunAction> {
        const name = this.collections.find(collectionId)?.manifest.name ?? 'This collection';
        const inventory = this.inventory(collectionId);
        const count = inventory?.entries.length ?? 0;
        let message: string;
        let detail: string;

        if (status === 'changed') {
            const changed = [
                ...(inventory?.entries.filter((entry) => entry.trust !== 'same').map((entry) => `${entry.name} (${entry.trust === 'new' ? 'new' : 'changed'})`) ?? []),
                ...(inventory?.removed.map((entry) => `${entry.name} (removed)`) ?? [])
            ];
            const list = changed.slice(0, 5).join(', ') + (changed.length > 5 ? ` and ${changed.length - 5} more` : '');

            message = `${changed.length || 'Some'} script${changed.length === 1 ? '' : 's'} of "${name}" changed outside Otto since you trusted them${list ? `: ${list}` : ''}.`;
            detail = 'They may come from a Git pull or another editor. Review the differences in the collection’s Security tab and trust them there to stop asking.';
        } else {
            message = `"${name}" ${count ? `has ${count} script${count === 1 ? '' : 's'} that run` : 'has scripts that run'} when you send requests, and this collection is set to ask before running them.`;
            detail = 'Scripts run in an isolated sandbox, limited by the permissions in the collection’s Security tab. Cancel does not send the request.';
        }

        const answer = await this.confirm.choose({
            header: 'Run Scripts?',
            message,
            detail,
            acceptLabel: 'Allow Once',
            acceptIcon: 'pi pi-play',
            alternativeLabel: 'Allow This Session',
            rejectLabel: 'Cancel',
            severity: 'warn',
            icon: 'pi pi-exclamation-triangle'
        });

        if (answer === 'alternative' && inventory) {
            this.sessionState.update((map) => new Map(map).set(collectionId, inventory.fingerprint));
        }

        return answer === 'cancel' ? 'cancel' : 'run';
    }
}
