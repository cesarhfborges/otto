import { inject, Injectable } from '@angular/core';
import type { EntityId, HttpResponse, HttpTimelineEntry, KeyValue, RequestDefinition } from '@shared/models';
import { createOtto, CURRENT_REQUEST_MEMBERS, messageReader, requestSnapshot, responseSnapshot } from '@shared/templating';
import { CollectionsState } from '../state/collections.state';
import { EnvironmentsState } from '../state/environments.state';
import { checkScript, describeViolation, SHADOWED_GLOBALS } from './script-policy';
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
}

export interface ScriptOutcome {
    /** Requisição após os `otto.request.set…` (igual à de entrada no post-response). */
    definition: RequestDefinition;
    logs: HttpTimelineEntry[];
    error: string | null;
}

type AsyncScript = (otto: unknown, console: unknown, ...shadowed: undefined[]) => Promise<void>;

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...args: string[]) => AsyncScript;

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
@Injectable({ providedIn: 'root' })
export class ScriptRunner {
    private readonly environments = inject(EnvironmentsState);
    private readonly collections = inject(CollectionsState);
    private readonly templates = inject(TemplateContextService);

    async run(phase: ScriptPhase, code: string, context: ScriptContext): Promise<ScriptOutcome> {
        const { collectionId, path, response } = context;
        const label = LABELS[phase];
        const now = new Date();
        const logs: HttpTimelineEntry[] = [];
        const log =
            (kind: HttpTimelineEntry['kind']) =>
            (...values: unknown[]) =>
                logs.push({ kind, text: `[${label}] ${values.map(stringify).join(' ')}` });

        let request = structuredClone(context.definition);
        const base = createOtto(this.templates.host(collectionId, path, context.definition, context.access, context.chain)) as Record<string, unknown>;
        const environment = this.environments.selected(collectionId);
        const manifest = this.collections.find(collectionId)?.manifest ?? null;
        const envStore = variableStore(environment?.variables ?? null, 'No environment is selected: select one in the top bar to use otto.environment.set', (key, value) => ({ key, value, enabled: true, secret: false }));
        const collectionStore = variableStore(manifest?.variables ?? null, 'The collection is not open', (key, value) => ({ key, value, enabled: true }));
        const scopes = this.templates.scopes(collectionId);
        // Alterações feitas neste script já valem na leitura resolvida.
        const resolve = (name: unknown) => envStore.api.get(name) ?? collectionStore.api.get(name) ?? scopes.lookup(String(name))?.value;
        const identity = { id: request.id ?? '', name: request.name, path, folder: path.split('/').slice(0, -1).join('/') };
        const reader = () => messageReader(requestSnapshot(request), now, {}, identity);
        const change = (apply: () => void) => () => {
            if (phase !== 'preRequest') {
                throw new Error('The request can only be changed in the pre-request script');
            }

            apply();
        };
        const setters = {
            setUrl: (url: unknown) => change(() => (request = { ...request, url: text(url) }))(),
            setMethod: (method: unknown) => change(() => (request = { ...request, method: text(method).toUpperCase() as RequestDefinition['method'] }))(),
            setHeader: (name: unknown, value: unknown) => change(() => (request = { ...request, headers: upsert(request.headers, String(name), text(value), true) }))(),
            addHeader: (name: unknown, value: unknown) => change(() => (request = { ...request, headers: [...request.headers, { key: String(name), value: text(value), enabled: true }] }))(),
            removeHeader: (name: unknown) => change(() => (request = { ...request, headers: request.headers.filter((item) => item.key.trim().toLowerCase() !== String(name).toLowerCase()) }))(),
            setParam: (name: unknown, value: unknown) => change(() => (request = { ...request, params: upsert(request.params, String(name), text(value), false) }))(),
            addParam: (name: unknown, value: unknown) => change(() => (request = { ...request, params: [...request.params, { key: String(name), value: text(value), enabled: true }] }))(),
            removeParam: (name: unknown) => change(() => (request = { ...request, params: request.params.filter((item) => item.key.trim() !== String(name)) }))(),
            setBody: (content: unknown, type?: unknown) =>
                change(() => {
                    const kind = type === 'json' || type === 'text' || type === 'xml' ? type : typeof content === 'string' ? (request.body.type === 'json' || request.body.type === 'xml' ? request.body.type : 'text') : 'json';

                    request = { ...request, body: { type: kind, content: typeof content === 'string' ? content : JSON.stringify(content, null, 2) } };
                })()
        };
        // `otto.request('…')` continua sendo outra requisição; `otto.request.x` lê a atual (síncrono).
        const otto = {
            ...base,
            request: Object.defineProperties(
                (ref: unknown, options?: unknown) => (base['request'] as (ref: unknown, options?: unknown) => unknown)(ref, options),
                Object.fromEntries([...CURRENT_REQUEST_MEMBERS.map((name) => [name, { enumerable: true, get: () => reader()[name] }]), ...Object.entries(setters).map(([name, value]) => [name, { enumerable: true, value }])])
            ),
            ...(response && { response: messageReader(responseSnapshot(response, now), now) }),
            environment: envStore.api,
            collectionVariables: collectionStore.api,
            variables: { get: resolve, has: (name: unknown) => resolve(name) !== undefined, all: () => ({ ...Object.fromEntries(scopes.entries().filter((entry) => !entry.shadowed).map((entry) => [entry.name, entry.value])), ...collectionStore.api.all(), ...envStore.api.all() }) }
        };
        const consoleApi = { log: log('info'), info: log('info'), debug: log('info'), warn: log('error'), error: log('error') };
        let error: string | null = null;

        // Bloqueia antes de executar; os globais bloqueados também viram parâmetros `undefined`
        // (o bloco `{}` deixa o script declarar `const open = …` sem colidir com eles).
        const violation = checkScript(code)[0];

        try {
            if (violation) {
                throw new Error(describeViolation(code, violation));
            }

            await new AsyncFunction('otto', 'console', ...SHADOWED_GLOBALS, `"use strict";\n{\n${code}\n}`)(otto, consoleApi);
        } catch (thrown) {
            error = `${label} script failed: ${errorMessage(thrown)}`;
            logs.push({ kind: 'error', text: `[${label}] ${errorMessage(thrown)}` });
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

        return { definition: phase === 'preRequest' ? request : context.definition, logs, error };
    }
}
