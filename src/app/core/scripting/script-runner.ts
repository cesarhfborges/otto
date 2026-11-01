import { inject, Injectable } from '@angular/core';
import type { EntityId, HttpResponse, HttpTimelineEntry, KeyValue, RequestDefinition, ScriptPermission, ScriptPermissions } from '@shared/models';
import type { OttoHost } from '@shared/templating';
import { createOtto, CURRENT_REQUEST_MEMBERS, messageReader, requestSnapshot, responseSnapshot } from '@shared/templating';
import { CollectionsState } from '../state/collections.state';
import { EnvironmentsState } from '../state/environments.state';
import { parentFolder } from '@shared/http/inheritance';
import { runSandboxed, ScriptError } from './script-sandbox';
import { scriptPermissionLabel, ScriptSecurityState, type ScriptActivityResult } from './script-security.state';
import { TemplateContextService, type ResponseAccess } from '../templating/template-context.service';

/** Fase do script: `otto.response` só existe no post-response; os `set…` da requisição só no pre-request. */
export type ScriptPhase = 'preRequest' | 'postResponse';

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
}

export interface ScriptOutcome {
    /** Requisição após os `otto.request.set…` (igual à de entrada no post-response). */
    definition: RequestDefinition;
    logs: HttpTimelineEntry[];
    error: string | null;
}

/** Maior espera aceita por `otto.sleep(ms)`. */
const MAX_SLEEP_MS = 60_000;
/** Limites do console: linhas por script e tamanho de cada uma. */
const MAX_LOG_LINES = 500;
const MAX_LOG_LENGTH = 10_000;

const LABELS: Record<ScriptPhase, string> = { preRequest: 'pre-request', postResponse: 'post-response' };

const stringify = (value: unknown): string => {
    if (typeof value === 'string') {
        return value;
    }

    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : stringify(error));

const text = (value: unknown): string => (value === undefined || value === null ? '' : stringify(value));

/** Variáveis (ambiente/coleção) sobre uma cópia; `changed` diz se precisam ser gravadas. */
function variableStore<T extends KeyValue>(initial: readonly T[] | null, unavailable: string, create: (key: string, value: string) => T) {
    let items = initial ? initial.map((item) => ({ ...item })) : [];
    let changed = false;
    const enabled = () => items.filter((item) => item.enabled && item.key.trim());

    const writable = () => {
        if (!initial) {
            throw new Error(unavailable);
        }

        changed = true;
    };

    return {
        changed: () => changed,
        items: () => items,
        api: {
            get: (name: unknown) => enabled().find((item) => item.key.trim() === String(name))?.value,
            has: (name: unknown) => enabled().some((item) => item.key.trim() === String(name)),
            all: () => Object.fromEntries(enabled().map((item) => [item.key.trim(), item.value])),
            set: (name: unknown, value: unknown) => {
                writable();
                const key = String(name ?? '').trim();
                const existing = items.find((item) => item.key.trim() === key);

                if (!key) {
                    throw new Error('A variable name is required');
                }

                items = existing ? items.map((item) => (item === existing ? { ...item, value: text(value), enabled: true } : item)) : [...items, create(key, text(value))];
            },
            unset: (name: unknown) => {
                writable();
                items = items.filter((item) => item.key.trim() !== String(name));
            }
        }
    };
}

/** Troca (ou acrescenta) o primeiro item com o nome e remove os demais repetidos. */
function upsert(items: KeyValue[], name: string, value: string, ignoreCase: boolean): KeyValue[] {
    const same = (key: string) => (ignoreCase ? key.trim().toLowerCase() === name.toLowerCase() : key.trim() === name);
    const index = items.findIndex((item) => same(item.key));

    return index < 0 ? [...items, { key: name, value, enabled: true }] : items.flatMap((item, i) => (i === index ? [{ ...item, value, enabled: true }] : same(item.key) ? [] : [item]));
}

/**
 * Executa os scripts da requisição. O `otto` é o mesmo dos templates (`otto.uuid()`,
 * `otto.request('…').response`, `otto.cookies`…), com leitura síncrona da requisição
 * atual e da resposta, mais `otto.environment`/`collectionVariables`/`variables` e os
 * `otto.request.set…` do pre-request. Variáveis alteradas são gravadas no fim do script.
 */
/** Valor que os scripts leem no lugar de variáveis secretas sem a permissão `readSecrets`. */
const MASKED_SECRET = '••••';

@Injectable({ providedIn: 'root' })
export class ScriptRunner {
    private readonly environments = inject(EnvironmentsState);
    private readonly collections = inject(CollectionsState);
    private readonly templates = inject(TemplateContextService);
    private readonly security = inject(ScriptSecurityState);

    async run(phase: ScriptPhase, code: string, context: ScriptContext): Promise<ScriptOutcome> {
        const { collectionId, path } = context;
        const label = context.origin ? `${LABELS[phase]} · ${context.origin}` : LABELS[phase];
        const activity = (result: ScriptActivityResult, message: string | null, durationMs: number | null) =>
            this.security.record(collectionId, { at: new Date(), path, requestName: context.definition.name, phase, origin: context.origin ?? null, durationMs, result, message });
        const decision = await this.security.allowed(collectionId);

        if (!decision.run) {
            if (decision.reason === 'disabled') {
                // Modo "Scripts disabled": a requisição segue sem o script.
                activity('skipped', 'Scripts are disabled for this collection', null);

                return { definition: context.definition, logs: [{ kind: 'info', text: `[${label}] script skipped: scripts are disabled by this collection's security policy (Security tab)` }], error: null };
            }

            const message = "scripts of this collection were not allowed to run (change it in the collection's Security tab)";

            activity('blocked', 'Not allowed to run in this session', null);

            return { definition: context.definition, logs: [{ kind: 'error', text: `[${label}] ${message}` }], error: `${label} script skipped: ${message}` };
        }

        const started = performance.now();

        this.security.running.set({ collectionId, requestName: context.definition.name, phase });

        try {
            const outcome = await this.execute(phase, code, context, label, decision.permissions);
            const durationMs = Math.round(performance.now() - started);

            activity(outcome.result, outcome.error ? outcome.message : null, durationMs);

            return { definition: outcome.definition, logs: outcome.logs, error: outcome.error };
        } finally {
            this.security.running.set(null);
        }
    }

    private async execute(
        phase: ScriptPhase,
        code: string,
        context: ScriptContext,
        label: string,
        permissions: ScriptPermissions
    ): Promise<ScriptOutcome & { result: ScriptActivityResult; message: string | null }> {
        const { collectionId, path, response } = context;
        const now = new Date();
        const logs: HttpTimelineEntry[] = [];
        let denied: string | null = null;

        /** API desligada pela política: existe, mas falha com uma mensagem clara. */
        const guard =
            <A extends unknown[], R>(permission: ScriptPermission, name: string, fn: (...args: A) => R) =>
            (...args: A): R => {
                if (!permissions[permission]) {
                    denied = `${name} is disabled by this collection's security policy ("${scriptPermissionLabel(permission)}" in the Security tab)`;

                    throw new Error(denied);
                }

                return fn(...args);
            };

        const log =
            (kind: HttpTimelineEntry['kind']) =>
            (...values: unknown[]) => {
                if (logs.length < MAX_LOG_LINES) {
                    const line = values.map(stringify).join(' ');

                    logs.push({ kind, text: `[${label}] ${line.length > MAX_LOG_LENGTH ? `${line.slice(0, MAX_LOG_LENGTH)}… (truncated)` : line}` });
                } else if (logs.length === MAX_LOG_LINES) {
                    logs.push({ kind: 'error', text: `[${label}] too many console messages: the rest was omitted` });
                }
            };

        let request = structuredClone(context.definition);
        const host = this.templates.host(collectionId, path, context.definition, context.access, context.chain);
        // Sem `sendRequests`: `otto.request('…')` ainda lê respostas guardadas, mas não envia.
        const guardedHost: OttoHost = {
            ...host,
            findRequest: (ref) => {
                const handle = host.findRequest(ref);

                return handle && { ...handle, send: guard('sendRequests', `Sending "${handle.name}" (otto.request('…'))`, () => handle.send()) };
            }
        };
        const base = createOtto(guardedHost) as Record<string, unknown>;
        const environment = this.environments.selected(collectionId);
        const manifest = this.collections.find(collectionId)?.manifest ?? null;
        const envStore = variableStore(environment?.variables ?? null, 'No environment is selected: select one in the top bar to use otto.environment.set', (key, value) => ({ key, value, enabled: true, secret: false }));
        const collectionStore = variableStore(manifest?.variables ?? null, 'The collection is not open', (key, value) => ({ key, value, enabled: true }));
        const scopes = this.templates.scopes(collectionId, parentFolder(path));
        // Sem `readSecrets`, variáveis secretas aparecem mascaradas (a requisição enviada continua com o valor real).
        const secretNames = new Set((environment?.variables ?? []).filter((item) => item.secret).map((item) => item.key.trim()));
        const reveal = (name: unknown, value: string | undefined) => (value !== undefined && !permissions.readSecrets && secretNames.has(String(name)) ? MASKED_SECRET : value);
        const revealAll = (values: Record<string, string>) => Object.fromEntries(Object.entries(values).map(([name, value]) => [name, reveal(name, value)!]));
        const environmentApi = {
            get: (name: unknown) => reveal(name, envStore.api.get(name)),
            has: envStore.api.has,
            all: () => revealAll(envStore.api.all()),
            set: guard('writeVariables', 'otto.environment.set', envStore.api.set),
            unset: guard('writeVariables', 'otto.environment.unset', envStore.api.unset)
        };
        const collectionApi = {
            ...collectionStore.api,
            set: guard('writeVariables', 'otto.collectionVariables.set', collectionStore.api.set),
            unset: guard('writeVariables', 'otto.collectionVariables.unset', collectionStore.api.unset)
        };
        // Ambiente → pastas (da mais próxima) → coleção; alterações feitas neste script já valem na leitura resolvida.
        const folderValue = (name: unknown) => scopes.lookup(String(name), 'folder')?.value;
        const resolve = (name: unknown) => environmentApi.get(name) ?? folderValue(name) ?? collectionStore.api.get(name) ?? reveal(name, scopes.lookup(String(name))?.value);
        const folderAll = () => Object.fromEntries(scopes.entries().filter((entry) => entry.scope === 'folder' && !entry.shadowed).map((entry) => [entry.name, entry.value]));
        const identity = { id: request.id ?? '', name: request.name, path, folder: path.split('/').slice(0, -1).join('/') };
        const reader = () => messageReader(requestSnapshot(request), now, {}, identity);

        const change = (name: string, apply: () => void) =>
            guard('modifyRequest', `otto.request.${name}`, () => {
                if (phase !== 'preRequest') {
                    throw new Error('The request can only be changed in the pre-request script');
                }

                apply();
            })();

        const setters = {
            setUrl: (url: unknown) => change('setUrl', () => (request = { ...request, url: text(url) })),
            setMethod: (method: unknown) => change('setMethod', () => (request = { ...request, method: text(method).toUpperCase() as RequestDefinition['method'] })),
            setHeader: (name: unknown, value: unknown) => change('setHeader', () => (request = { ...request, headers: upsert(request.headers, String(name), text(value), true) })),
            addHeader: (name: unknown, value: unknown) => change('addHeader', () => (request = { ...request, headers: [...request.headers, { key: String(name), value: text(value), enabled: true }] })),
            removeHeader: (name: unknown) => change('removeHeader', () => (request = { ...request, headers: request.headers.filter((item) => item.key.trim().toLowerCase() !== String(name).toLowerCase()) })),
            setParam: (name: unknown, value: unknown) => change('setParam', () => (request = { ...request, params: upsert(request.params, String(name), text(value), false) })),
            addParam: (name: unknown, value: unknown) => change('addParam', () => (request = { ...request, params: [...request.params, { key: String(name), value: text(value), enabled: true }] })),
            removeParam: (name: unknown) => change('removeParam', () => (request = { ...request, params: request.params.filter((item) => item.key.trim() !== String(name)) })),
            setBody: (content: unknown, type?: unknown) =>
                change('setBody', () => {
                    const kind = type === 'json' || type === 'text' || type === 'xml' ? type : typeof content === 'string' ? (request.body.type === 'json' || request.body.type === 'xml' ? request.body.type : 'text') : 'json';

                    request = { ...request, body: { type: kind, content: typeof content === 'string' ? content : JSON.stringify(content, null, 2) } };
                })
        };
        const cookies = base['cookies'] as Record<string, (...args: unknown[]) => unknown>;
        // `otto.request('…')` continua sendo outra requisição; `otto.request.x` lê a atual (síncrono).
        const otto = {
            ...base,
            request: Object.defineProperties(
                (ref: unknown, options?: unknown) => (base['request'] as (ref: unknown, options?: unknown) => unknown)(ref, options),
                Object.fromEntries([...CURRENT_REQUEST_MEMBERS.map((name) => [name, { enumerable: true, get: () => reader()[name] }]), ...Object.entries(setters).map(([name, value]) => [name, { enumerable: true, value }])])
            ),
            ...(response && { response: messageReader(responseSnapshot(response, now), now) }),
            cookies: {
                ...cookies,
                set: guard('writeCookies', 'otto.cookies.set', cookies['set']!),
                remove: guard('writeCookies', 'otto.cookies.remove', cookies['remove']!),
                clear: guard('writeCookies', 'otto.cookies.clear', cookies['clear']!)
            },
            sleep: (ms: unknown) => new Promise<string>((resolve) => setTimeout(() => resolve(''), Math.min(Math.max(Number(ms) || 0, 0), MAX_SLEEP_MS))),
            environment: environmentApi,
            collectionVariables: collectionApi,
            variables: {
                get: resolve,
                has: (name: unknown) => resolve(name) !== undefined,
                all: () => revealAll({ ...Object.fromEntries(scopes.entries().filter((entry) => !entry.shadowed).map((entry) => [entry.name, entry.value])), ...collectionStore.api.all(), ...folderAll(), ...envStore.api.all() })
            }
        };
        const consoleApi = { log: log('info'), info: log('info'), debug: log('info'), warn: log('error'), error: log('error') };
        let error: string | null = null;
        let result: ScriptActivityResult = 'ok';
        let message: string | null = null;

        // Realm isolado (QuickJS): o script só enxerga `otto` e `console`.
        try {
            await runSandboxed(code, { otto, console: consoleApi });
        } catch (thrown) {
            message = errorMessage(thrown);
            error = `${label} script failed: ${message}`;
            result = denied ? 'blocked' : thrown instanceof ScriptError && thrown.reason !== 'error' ? 'stopped' : 'error';
            logs.push({ kind: 'error', text: `[${label}] ${message}` });
        }

        try {
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

        return { definition: phase === 'preRequest' ? request : context.definition, logs, error, result, message };
    }
}
