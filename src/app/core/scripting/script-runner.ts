import { inject, Injectable } from '@angular/core';
import type { EntityId, HttpResponse, HttpTimelineEntry, KeyValue, RequestDefinition, ScriptPermissions } from '@shared/models';
import { parentFolder } from '@shared/http/inheritance';
import { referencedRequest, responseSnapshot, type MessageSnapshot, type VariableLayer } from '@shared/templating';
import { CollectionsState } from '../state/collections.state';
import { EnvironmentsState } from '../state/environments.state';
import { TemplateContextService, type ResponseAccess } from '../templating/template-context.service';
import { deniedMessage, errorMessage, variableStore, type ScriptInput, type ScriptPhase } from './script-api';
import { DEFAULT_SANDBOX_LIMITS } from './script-sandbox';
import { ScriptSecurityState, type ScriptActivityResult } from './script-security.state';
import { ScriptTimeoutError, ScriptWorkerPool } from './script-worker-pool';
import type { ScriptRpcCall } from './script-worker-protocol';

export type { ScriptPhase } from './script-api';

export interface ScriptContext {
    collectionId: EntityId;
    path: string;
    /** Pre-request: a requisição como está no editor; post-response: a enviada (interpolada). */
    definition: RequestDefinition;
    /** Para `otto.request('…')` (outras requisições) e detecção de ciclos. */
    access: ResponseAccess;
    chain: readonly string[];
    /** Só no post-response. */
    response?: HttpResponse;
    /** De onde vem o script herdado (`collection`, `folder Auth`); `null`/ausente = da própria requisição. */
    origin?: string | null;
    /** Permissões decididas para este envio (`ScriptSecurityState.beginSend`). */
    permissions: ScriptPermissions;
}

export interface ScriptOutcome {
    /** Requisição após os `otto.request.set…` (igual à de entrada no post-response). */
    definition: RequestDefinition;
    logs: HttpTimelineEntry[];
    error: string | null;
}

const LABELS: Record<ScriptPhase, string> = { preRequest: 'pre-request', postResponse: 'post-response' };

/** Itens secretos trocados por `••••` (o que um script sem `readSecrets` pode ver). */
const maskItems = <T extends KeyValue & { secret?: boolean }>(items: readonly T[], reveal: boolean): T[] => (reveal ? items.map((item) => ({ ...item })) : items.map((item) => (item.secret ? { ...item, value: '••••' } : { ...item })));

/**
 * Executa os scripts da requisição num Web Worker (`script-worker-pool.ts`). O worker
 * recebe cópias dos dados (sem os segredos, se o script não pode lê-los), roda o script no
 * QuickJS e devolve o que mudou; aqui as variáveis e cookies alterados são gravados, e
 * `otto.request('…')` (outras requisições) é atendido por RPC.
 */
@Injectable({ providedIn: 'root' })
export class ScriptRunner {
    private readonly environments = inject(EnvironmentsState);
    private readonly collections = inject(CollectionsState);
    private readonly templates = inject(TemplateContextService);
    private readonly security = inject(ScriptSecurityState);
    private readonly pool = inject(ScriptWorkerPool);

    /** Modo Blocked: registra que o script foi pulado (a requisição segue sem ele). */
    skip(phase: ScriptPhase, context: Pick<ScriptContext, 'collectionId' | 'path' | 'definition' | 'origin'>): HttpTimelineEntry {
        const label = context.origin ? `${LABELS[phase]} · ${context.origin}` : LABELS[phase];

        this.security.record(context.collectionId, {
            at: new Date(),
            path: context.path,
            requestName: context.definition.name,
            phase,
            origin: context.origin ?? null,
            durationMs: null,
            result: 'skipped',
            message: 'Scripts are blocked for this collection'
        });

        return { kind: 'info', text: `[${label}] script skipped: scripts are blocked for this collection (Security tab)` };
    }

    async run(phase: ScriptPhase, code: string, context: ScriptContext): Promise<ScriptOutcome> {
        const { collectionId, path } = context;
        const label = context.origin ? `${LABELS[phase]} · ${context.origin}` : LABELS[phase];
        const activity = (result: ScriptActivityResult, message: string | null, durationMs: number | null) =>
            this.security.record(collectionId, { at: new Date(), path, requestName: context.definition.name, phase, origin: context.origin ?? null, durationMs, result, message });
        const started = performance.now();

        this.security.running.set({ collectionId, requestName: context.definition.name, phase });

        try {
            const outcome = await this.execute(phase, code, context, label, context.permissions);
            const durationMs = Math.round(performance.now() - started);

            activity(outcome.result, outcome.error ? outcome.message : null, durationMs);

            return { definition: outcome.definition, logs: outcome.logs, error: outcome.error };
        } finally {
            this.security.running.set(null);
        }
    }

    /** Primeiro valor gravado pelo script que depende de variável secreta (`otto.environment.set("x")`), ou `null`. */
    private async secretWrite(context: ScriptContext, stores: ReadonlyArray<[string, readonly KeyValue[], readonly KeyValue[]]>): Promise<string | null> {
        for (const [api, before, after] of stores) {
            for (const item of after) {
                const previous = before.find((entry) => entry.key.trim() === item.key.trim());

                if (previous?.value !== item.value && (await this.templates.usesSecret(context.collectionId, context.path, context.definition, context.access, context.chain, item.value))) {
                    return `${api}("${item.key.trim()}")`;
                }
            }
        }

        return null;
    }

    private async execute(phase: ScriptPhase, code: string, context: ScriptContext, label: string, permissions: ScriptPermissions): Promise<ScriptOutcome & { result: ScriptActivityResult; message: string | null }> {
        const { collectionId, path, response } = context;
        const now = new Date();
        const environment = this.environments.selected(collectionId);
        const manifest = this.collections.find(collectionId)?.manifest ?? null;
        const scopes = this.templates.scopes(collectionId, parentFolder(path));
        const host = this.templates.host(collectionId, path, context.definition, context.access, context.chain);
        const layers: VariableLayer[] = (permissions.readSecrets ? scopes : scopes.masked()).layers.map((layer) => ({ ...layer, items: layer.items.map((item) => ({ ...item })) }));
        const requests = this.templates.requests(collectionId).map((entry) => ({ ...entry, hasResponse: context.access.lastResponse(collectionId, entry.path) !== null }));
        let denied: string | null = null;

        const input: ScriptInput = {
            phase,
            code,
            label,
            now: now.getTime(),
            path,
            request: structuredClone(context.definition),
            response: response ? responseSnapshot(response, now) : null,
            environment: environment ? maskItems(environment.variables, permissions.readSecrets) : null,
            collectionVariables: manifest ? maskItems(manifest.variables, permissions.readSecrets) : null,
            scopes: layers,
            cookies: manifest ? manifest.cookies.map((cookie) => ({ ...cookie })) : null,
            permissions: { ...permissions },
            collection: host.collection,
            info: { ...host.info },
            requests,
            limits: DEFAULT_SANDBOX_LIMITS
        };

        /** `otto.request('…')` e cookies: o worker pede, o app decide (e respeita `sendRequests`). */
        const rpc = async (call: ScriptRpcCall): Promise<unknown> => {
            switch (call.method) {
                case 'response': {
                    const guarded = {
                        ...host,
                        findRequest: (ref: string) => {
                            const handle = host.findRequest(ref);

                            return (
                                handle && {
                                    ...handle,
                                    send: () => {
                                        if (!permissions.sendRequests) {
                                            denied = deniedMessage('sendRequests', `Sending "${handle.name}" (otto.request('…'))`);

                                            return Promise.reject(new Error(denied));
                                        }

                                        return handle.send();
                                    }
                                }
                            );
                        }
                    };

                    return referencedRequest(guarded, call.args[0], call.args[1] ?? undefined).response() satisfies Promise<MessageSnapshot>;
                }
                case 'request':
                    return referencedRequest(host, call.args[0]).request();
                case 'saveCookies':
                    if (!permissions.writeCookies) {
                        throw new Error(deniedMessage('writeCookies', 'otto.cookies'));
                    }

                    return this.collections.updateManifest(collectionId, { cookies: call.args[0] }).then(() => undefined);
            }
        };

        const logs: HttpTimelineEntry[] = [];
        let error: string | null = null;
        let result: ScriptActivityResult = 'ok';
        let message: string | null = null;
        let output: Awaited<ReturnType<ScriptWorkerPool['run']>> | null = null;

        try {
            output = await this.pool.run(input, rpc);
        } catch (thrown) {
            message = errorMessage(thrown);
            error = `${label} script failed: ${message}`;
            result = thrown instanceof ScriptTimeoutError ? 'stopped' : 'error';
            logs.push({ kind: 'error', text: `[${label}] ${message}` });

            return { definition: context.definition, logs, error, result, message };
        }

        logs.push(...output.logs);
        denied ??= output.denied;

        if (output.error) {
            message = output.error.message;
            error = `${label} script failed: ${message}`;
            result = denied ? 'blocked' : output.error.reason !== 'error' ? 'stopped' : 'error';
            logs.push({ kind: 'error', text: `[${label}] ${message}` });
        }

        // As alterações feitas sobre as cópias (mascaradas) são reaplicadas sobre os valores reais.
        const envStore = variableStore(environment?.variables ?? null, '', (key, value) => ({ key, value, enabled: true, secret: false }));
        const collectionStore = variableStore(manifest?.variables ?? null, '', (key, value) => ({ key, value, enabled: true }));

        try {
            envStore.apply(output.environmentOps);
            collectionStore.apply(output.collectionOps);
        } catch {
            // O ambiente/coleção sumiu durante o script: nada a gravar.
        }

        // Sem `readSecrets`, o script não pode gravar um valor que, interpolado, revela um segredo (`{{token}}`).
        const secretLeak = permissions.readSecrets
            ? null
            : await this.secretWrite(context, [
                  ['otto.environment.set', environment?.variables ?? [], envStore.changed() ? envStore.items() : []],
                  ['otto.collectionVariables.set', manifest?.variables ?? [], collectionStore.changed() ? collectionStore.items() : []]
              ]);

        if (secretLeak) {
            const leakMessage = `${secretLeak} uses a secret variable, which this script's permissions do not allow (turn on "Read secret variables" in the Security tab). No variable was saved.`;

            error ??= `${label} script failed: ${leakMessage}`;
            message ??= leakMessage;
            result = 'blocked';
            logs.push({ kind: 'error', text: `[${label}] ${leakMessage}` });

            return { definition: context.definition, logs, error, result, message };
        }

        try {
            if (output.cookies && manifest) {
                await this.collections.updateManifest(collectionId, { cookies: output.cookies });
            }

            if (environment && envStore.changed()) {
                await this.environments.update(environment, { name: environment.name, variables: envStore.items() });
            }

            if (manifest && collectionStore.changed()) {
                await this.collections.updateManifest(collectionId, { variables: collectionStore.items() });
            }
        } catch (thrown) {
            error ??= `${label} script: could not save variables: ${errorMessage(thrown)}`;
            logs.push({ kind: 'error', text: `[${label}] could not save variables: ${errorMessage(thrown)}` });
        }

        return { definition: phase === 'preRequest' ? output.request : context.definition, logs, error, result, message };
    }
}
