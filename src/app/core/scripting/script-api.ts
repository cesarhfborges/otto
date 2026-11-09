import type { CollectionCookie, HttpTimelineEntry, KeyValue, RequestDefinition, ScriptPermission, ScriptPermissions } from '@shared/models';
import { createOtto, CURRENT_REQUEST_MEMBERS, messageReader, requestSnapshot, VariableScopes, type MessageSnapshot, type OttoHost, type VariableLayer } from '@shared/templating';
import { DEFAULT_SANDBOX_LIMITS, runSandboxed, ScriptError, type SandboxLimits, type ScriptStopReason } from './script-sandbox';

/**
 * API `otto` dos scripts, montada dentro do Web Worker a partir de dados (`ScriptInput`).
 * Nada aqui depende do Angular: o worker recebe cópias (com os segredos já mascarados
 * quando o script não pode lê-los), roda o script e devolve o que mudou (`ScriptOutput`).
 * Só o que precisa do app (outras requisições, gravar cookies antes de enviá-las) volta
 * por RPC.
 */

/** Fase do script: `otto.response` só existe no post-response; os `set…` da requisição só no pre-request. */
export type ScriptPhase = 'preRequest' | 'postResponse';

export interface ScriptRequestEntry {
    id: string | null;
    name: string;
    path: string;
    folder: string;
    method: string;
    hasResponse: boolean;
}

export interface ScriptInput {
    phase: ScriptPhase;
    code: string;
    /** Prefixo das mensagens do console (`pre-request · collection`). */
    label: string;
    /** Instante do envio (ms). */
    now: number;
    path: string;
    request: RequestDefinition;
    response: MessageSnapshot | null;
    /** Variáveis do ambiente selecionado (`null` = nenhum) e da coleção, já mascaradas se preciso. */
    environment: KeyValue[] | null;
    collectionVariables: KeyValue[] | null;
    /** Cadeia de escopos (ambiente → pastas → coleção), já mascarada se preciso. */
    scopes: VariableLayer[];
    cookies: CollectionCookie[] | null;
    permissions: ScriptPermissions;
    collection: { id: string; name: string } | null;
    info: OttoHost['info'];
    requests: ScriptRequestEntry[];
    limits: SandboxLimits;
}

export type VariableOp = { op: 'set'; key: string; value: string } | { op: 'unset'; key: string };

export interface ScriptOutput {
    /** Requisição após os `otto.request.set…` (igual à de entrada no post-response). */
    request: RequestDefinition;
    environmentOps: VariableOp[];
    collectionOps: VariableOp[];
    /** Cookies ainda não enviados por RPC (`null` = sem mudança pendente). */
    cookies: CollectionCookie[] | null;
    logs: HttpTimelineEntry[];
    error: { message: string; reason: ScriptStopReason } | null;
    /** Mensagem da última API negada pelas permissões. */
    denied: string | null;
}

/** Chamadas do worker para o app. */
export interface ScriptRpc {
    response(ref: string, options: unknown): Promise<MessageSnapshot>;
    request(ref: string): Promise<MessageSnapshot>;
    saveCookies(cookies: CollectionCookie[]): Promise<void>;
}

/** Maior espera aceita por `otto.sleep(ms)`. */
const MAX_SLEEP_MS = 60_000;
/** Limites do console: linhas por script e tamanho de cada uma. */
const MAX_LOG_LINES = 500;
const MAX_LOG_LENGTH = 10_000;

const PERMISSION_LABELS: Record<ScriptPermission, string> = {
    modifyRequest: 'Change the request being sent',
    writeVariables: 'Write environment and collection variables',
    writeCookies: 'Change cookies',
    sendRequests: 'Send other requests of the collection',
    readSecrets: 'Read secret variables'
};

export const scriptPermissionLabel = (permission: ScriptPermission): string => PERMISSION_LABELS[permission];

export const deniedMessage = (permission: ScriptPermission, name: string): string => `${name} is disabled by this collection's security policy ("${scriptPermissionLabel(permission)}" in the Security tab)`;

export const stringify = (value: unknown): string => {
    if (typeof value === 'string') {
        return value;
    }

    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
};

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : stringify(error));

const text = (value: unknown): string => (value === undefined || value === null ? '' : stringify(value));

/** Variáveis (ambiente/coleção) sobre uma cópia; `ops` registra o que gravar depois. */
export function variableStore<T extends KeyValue>(initial: readonly T[] | null, unavailable: string, create: (key: string, value: string) => T) {
    let items = initial ? initial.map((item) => ({ ...item })) : [];
    const ops: VariableOp[] = [];
    const enabled = () => items.filter((item) => item.enabled && item.key.trim());

    const writable = () => {
        if (!initial) {
            throw new Error(unavailable);
        }
    };

    const set = (name: unknown, value: unknown) => {
        writable();
        const key = String(name ?? '').trim();
        const existing = items.find((item) => item.key.trim() === key);

        if (!key) {
            throw new Error('A variable name is required');
        }

        items = existing ? items.map((item) => (item === existing ? { ...item, value: text(value), enabled: true } : item)) : [...items, create(key, text(value))];
        ops.push({ op: 'set', key, value: text(value) });
    };

    const unset = (name: unknown) => {
        writable();
        items = items.filter((item) => item.key.trim() !== String(name));
        ops.push({ op: 'unset', key: String(name) });
    };

    return {
        changed: () => ops.length > 0,
        items: () => items,
        ops: () => ops,
        /** Reaplica operações feitas em outra cópia (no app, sobre os valores reais). */
        apply: (changes: readonly VariableOp[]) => changes.forEach((change) => (change.op === 'set' ? set(change.key, change.value) : unset(change.key))),
        api: {
            get: (name: unknown) => enabled().find((item) => item.key.trim() === String(name))?.value,
            has: (name: unknown) => enabled().some((item) => item.key.trim() === String(name)),
            all: () => Object.fromEntries(enabled().map((item) => [item.key.trim(), item.value])),
            set,
            unset
        }
    };
}

/** Troca (ou acrescenta) o primeiro item com o nome e remove os demais repetidos. */
function upsert(items: KeyValue[], name: string, value: string, ignoreCase: boolean): KeyValue[] {
    const same = (key: string) => (ignoreCase ? key.trim().toLowerCase() === name.toLowerCase() : key.trim() === name);
    const index = items.findIndex((item) => same(item.key));

    return index < 0 ? [...items, { key: name, value, enabled: true }] : items.flatMap((item, i) => (i === index ? [{ ...item, value, enabled: true }] : same(item.key) ? [] : [item]));
}

/** Por `id` estável ou caminho (`auth/login` ou `auth/login.yaml`), como `TemplateContextService.findRequest`. */
const findEntry = (requests: readonly ScriptRequestEntry[], ref: string): ScriptRequestEntry | null =>
    requests.find((request) => request.id === ref) ?? requests.find((request) => request.path === ref || request.path.replace(/\.[^./]+$/, '') === ref) ?? null;

/** Roda o script no sandbox (QuickJS) com o `otto` montado a partir de `input`. */
export async function runScript(input: ScriptInput, rpc: ScriptRpc): Promise<ScriptOutput> {
    const { phase, label, permissions, path } = input;
    const now = new Date(input.now);
    const logs: HttpTimelineEntry[] = [];
    let denied: string | null = null;
    let request = structuredClone(input.request);
    let cookies = input.cookies ? input.cookies.map((cookie) => ({ ...cookie })) : null;
    let cookiesPending = false;

    /** API desligada pela política: existe, mas falha com uma mensagem clara. */
    const guard =
        <A extends unknown[], R>(permission: ScriptPermission, name: string, fn: (...args: A) => R) =>
        (...args: A): R => {
            if (!permissions[permission]) {
                denied = deniedMessage(permission, name);

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

    /** Cookies alterados vão para o app antes de enviar outra requisição (que pode usá-los). */
    const flushCookies = async () => {
        if (cookiesPending && cookies) {
            cookiesPending = false;
            await rpc.saveCookies(cookies);
        }
    };

    const host: OttoHost = {
        preview: false,
        collection: input.collection,
        info: input.info,
        currentRequest: { id: request.id ?? null, name: request.name, path, folder: path.split('/').slice(0, -1).join('/'), method: request.method },
        // `otto.request('…')` é montado abaixo (via RPC); o `createOtto` daqui não o usa.
        findRequest: () => null,
        cookies: cookies
            ? {
                  list: () => cookies ?? [],
                  save: (next) => {
                      cookies = next.map((cookie) => ({ ...cookie }));
                      cookiesPending = true;

                      return Promise.resolve();
                  }
              }
            : undefined
    };
    const base = createOtto(host) as Record<string, unknown>;
    const scopes = new VariableScopes(input.scopes);
    const envStore = variableStore(input.environment, 'No environment is selected: select one in the top bar to use otto.environment.set', (key, value) => ({ key, value, enabled: true, secret: false }));
    const collectionStore = variableStore(input.collectionVariables, 'The collection is not open', (key, value) => ({ key, value, enabled: true }));
    const environmentApi = {
        ...envStore.api,
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
    const resolve = (name: unknown) => envStore.api.get(name) ?? folderValue(name) ?? collectionStore.api.get(name) ?? scopes.lookup(String(name))?.value;
    const folderAll = () =>
        Object.fromEntries(
            scopes
                .entries()
                .filter((entry) => entry.scope === 'folder' && !entry.shadowed)
                .map((entry) => [entry.name, entry.value])
        );
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

    /** Outra requisição da coleção: identidade aqui, resposta e definição pelo app (que decide se envia). */
    const referenced = (ref: unknown, options?: unknown) => {
        const entry = findEntry(input.requests, String(ref ?? ''));

        if (!entry) {
            throw new Error(`Request "${String(ref)}" not found in this collection`);
        }

        return {
            id: entry.id ?? '',
            name: entry.name,
            path: entry.path,
            folder: entry.folder,
            method: entry.method,
            hasResponse: entry.hasResponse,
            get response() {
                return flushCookies()
                    .then(() => rpc.response(entry.path, options ?? null))
                    .then((snapshot) => messageReader(snapshot, now));
            },
            get request() {
                return rpc.request(entry.path).then((snapshot) => messageReader(snapshot, now));
            }
        };
    };

    const cookieApi = base['cookies'] as Record<string, (...args: unknown[]) => unknown>;
    // `otto.request('…')` é outra requisição; `otto.request.x` lê a atual (síncrono).
    const otto = {
        ...base,
        request: Object.defineProperties(
            referenced,
            Object.fromEntries([...CURRENT_REQUEST_MEMBERS.map((name) => [name, { enumerable: true, get: () => reader()[name] }]), ...Object.entries(setters).map(([name, value]) => [name, { enumerable: true, value }])])
        ),
        ...(input.response && { response: messageReader(input.response, now) }),
        cookies: {
            ...cookieApi,
            set: guard('writeCookies', 'otto.cookies.set', cookieApi['set']!),
            remove: guard('writeCookies', 'otto.cookies.remove', cookieApi['remove']!),
            clear: guard('writeCookies', 'otto.cookies.clear', cookieApi['clear']!)
        },
        sleep: (ms: unknown) => new Promise<string>((done) => setTimeout(() => done(''), Math.min(Math.max(Number(ms) || 0, 0), MAX_SLEEP_MS))),
        environment: environmentApi,
        collectionVariables: collectionApi,
        variables: {
            get: resolve,
            has: (name: unknown) => resolve(name) !== undefined,
            all: () => ({
                ...Object.fromEntries(
                    scopes
                        .entries()
                        .filter((entry) => !entry.shadowed)
                        .map((entry) => [entry.name, entry.value])
                ),
                ...collectionStore.api.all(),
                ...folderAll(),
                ...envStore.api.all()
            })
        }
    };
    const consoleApi = { log: log('info'), info: log('info'), debug: log('info'), warn: log('error'), error: log('error') };
    let error: ScriptOutput['error'] = null;

    // Realm isolado (QuickJS): o script só enxerga `otto` e `console`.
    try {
        await runSandboxed(input.code, { otto, console: consoleApi }, input.limits ?? DEFAULT_SANDBOX_LIMITS);
    } catch (thrown) {
        error = { message: errorMessage(thrown), reason: thrown instanceof ScriptError ? thrown.reason : 'error' };
    }

    return {
        request: phase === 'preRequest' ? request : input.request,
        environmentOps: envStore.ops(),
        collectionOps: collectionStore.ops(),
        cookies: cookiesPending ? cookies : null,
        logs,
        error,
        denied
    };
}
