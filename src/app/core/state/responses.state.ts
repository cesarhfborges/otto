import { Injectable, inject, signal } from '@angular/core';
import { buildHttpRequest } from '@shared/http/build-request';
import { parentFolder, type InheritanceLevel } from '@shared/http/inheritance';
import { applySetCookies, cookieHeaderFor } from '@shared/http/cookie-jar';
import type { EntityId, HttpRequest, HttpResult, HttpTimelineEntry, RequestDefinition } from '@shared/models';
import { responseSnapshot, TemplateError, type MessageSnapshot } from '@shared/templating';
import { ipcErrorMessage } from '../bridge/ipc-error';
import { HttpGateway } from '../ports';
import { CollectionsState } from './collections.state';
import { RequestHistoryState } from './request-history.state';
import { TemplateContextService, type ResponseAccess } from '../templating/template-context.service';
import { ScriptRunner } from '../scripting/script-runner';
import { ScriptSecurityState, type ScriptRunDecision } from '../scripting/script-security.state';

/** `startedAt` (ms, `Date.now()`) alimenta o contador de tempo exibido durante o envio. */
export type ResponseEntry = { status: 'sending'; requestId: string; startedAt: number } | { status: 'done'; result: HttpResult; receivedAt: number };

/** Respostas guardadas em memória (corpos podem ser grandes); as mais antigas saem primeiro. */
const MAX_KEPT_RESPONSES = 20;

export const responseKey = (collectionId: EntityId, path: string): string => `${collectionId}:${path}`;

const failure = (error: string, code?: string, timeline: HttpTimelineEntry[] = []): HttpResult => ({ ok: false, error, ...(code && { code }), timeMs: 0, timeline });

/** Campos que um script pode mudar, com o rótulo usado nas mensagens (headers e params por nome). */
function scriptFields(definition: RequestDefinition): Map<string, string> {
    const fields = new Map<string, string>([
        ['the URL', definition.url],
        ['the method', definition.method],
        ['the body', JSON.stringify(definition.body)]
    ]);
    const add = (label: string, value: string) => fields.set(label, fields.has(label) ? `${fields.get(label)}\n${value}` : value);

    definition.headers.filter((item) => item.enabled).forEach((item) => add(`header "${item.key.trim()}"`.toLowerCase(), item.value));
    definition.params.filter((item) => item.enabled).forEach((item) => add(`query parameter "${item.key.trim()}"`, item.value));

    return fields;
}

const hostOf = (url: string): string | null => {
    try {
        return new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `http://${url}`).host || null;
    } catch {
        return null;
    }
};

/** Mensagens dos scripts entram no console antes (pre-request) e depois (post-response) das da execução. */
const withLogs = (result: HttpResult, before: HttpTimelineEntry[], after: HttpTimelineEntry[] = []): HttpResult => (before.length || after.length ? { ...result, timeline: [...before, ...result.timeline, ...after] } : result);

/**
 * Execuções das requisições abertas, por arquivo da coleção. Fica fora do
 * componente para a resposta sobreviver à troca de abas. Também atende o motor de
 * templates (`otto.request(…)`): última resposta e envio sob demanda.
 */
@Injectable({ providedIn: 'root' })
export class ResponsesState implements ResponseAccess {
    private readonly http = inject(HttpGateway);
    private readonly templates = inject(TemplateContextService);
    private readonly collections = inject(CollectionsState);
    private readonly scripts = inject(ScriptRunner);
    private readonly security = inject(ScriptSecurityState);
    private readonly history = inject(RequestHistoryState);
    private readonly entries = signal<ReadonlyMap<string, ResponseEntry>>(new Map());

    get(key: string): ResponseEntry | undefined {
        return this.entries().get(key);
    }

    lastResponse(collectionId: EntityId, path: string): MessageSnapshot | null {
        const entry = this.get(responseKey(collectionId, path));

        return entry?.status === 'done' && entry.result.ok ? responseSnapshot(entry.result.response, new Date(entry.receivedAt)) : null;
    }

    async sendReferenced(collectionId: EntityId, path: string, chain: readonly string[]): Promise<MessageSnapshot> {
        await this.send(collectionId, path, await this.templates.definition(collectionId, path), chain);
        const entry = this.get(responseKey(collectionId, path));

        if (entry?.status === 'done' && !entry.result.ok) {
            throw new TemplateError(`${path} failed: ${entry.result.error}`);
        }

        const snapshot = this.lastResponse(collectionId, path);

        if (!snapshot) {
            throw new TemplateError(`${path} is already being sent`);
        }

        return snapshot;
    }

    /**
     * `chain`: requisições que dependem desta (envio em cascata), para detectar ciclos. Se
     * houver scripts, a política de segurança decide uma vez para o envio inteiro.
     */
    async send(collectionId: EntityId, path: string, definition: RequestDefinition, chain: readonly string[] = []): Promise<void> {
        const scriptChain = this.scriptChain(collectionId, path, definition);

        if (!scriptChain.some(({ scripts }) => scripts.preRequest?.trim() || scripts.postResponse?.trim())) {
            return this.dispatch(collectionId, path, definition, chain, scriptChain, null);
        }

        const decision = await this.security.beginSend(collectionId);

        try {
            if (decision.action === 'cancel') {
                this.set(responseKey(collectionId, path), { status: 'done', result: failure('Cancelled: the scripts of this collection were not allowed to run, so the request was not sent.', 'SCRIPTS_CANCELLED'), receivedAt: Date.now() });

                return;
            }

            await this.dispatch(collectionId, path, definition, chain, scriptChain, decision);
        } finally {
            this.security.endSend(collectionId);
        }
    }

    private async dispatch(collectionId: EntityId, path: string, definition: RequestDefinition, chain: readonly string[], scriptChain: ReturnType<ResponsesState['scriptChain']>, decision: ScriptRunDecision | null): Promise<void> {
        const key = responseKey(collectionId, path);
        const original = definition;

        if (this.get(key)?.status === 'sending') {
            return;
        }

        if (chain.includes(path)) {
            throw new TemplateError(`Circular reference between requests: ${[...chain, path].join(' → ')}`);
        }

        const preLogs: HttpTimelineEntry[] = [];

        // Coleção → pastas (de fora para dentro) → requisição; cada um recebe a requisição já alterada pelo anterior.
        for (const { origin, scripts } of scriptChain) {
            const preRequest = scripts.preRequest;

            if (!preRequest?.trim() || !decision) {
                continue;
            }

            if (decision.action === 'skip') {
                preLogs.push(this.scripts.skip('preRequest', { collectionId, path, definition, origin }));
                continue;
            }

            const outcome = await this.scripts.run('preRequest', preRequest, { collectionId, path, definition, access: this, chain: [...chain, path], origin, permissions: decision.permissions });

            preLogs.push(...outcome.logs);

            if (outcome.error) {
                this.set(key, { status: 'done', result: failure(outcome.error, 'SCRIPT_ERROR', preLogs), receivedAt: Date.now() });

                return;
            }

            definition = outcome.definition;
        }

        const { definition: resolved, unresolved, errors } = await this.templates.prepare(collectionId, path, definition, this, [...chain, path]);

        if (unresolved.length || errors.length) {
            this.set(key, { status: 'done', result: failure(this.describeProblems(collectionId, path, unresolved, errors), unresolved.length ? 'UNRESOLVED_VARIABLES' : 'TEMPLATE_ERROR', preLogs), receivedAt: Date.now() });

            return;
        }

        if (decision?.action === 'run' && definition !== original) {
            const guard = await this.checkScriptChanges(collectionId, path, original, definition, resolved, chain, decision.permissions.readSecrets);

            if (guard.error) {
                this.set(key, { status: 'done', result: failure(guard.error, 'SCRIPT_SECRET', preLogs), receivedAt: Date.now() });

                return;
            }

            preLogs.push(...guard.warnings);
        }

        let request: HttpRequest = { ...buildHttpRequest(resolved, { id: crypto.randomUUID(), source: { collectionId, requestPath: path } }) };

        if (!request.url) {
            this.set(key, { status: 'done', result: failure('Enter a URL to send this request.', 'MISSING_URL', preLogs), receivedAt: Date.now() });

            return;
        }

        // Cookies da coleção, a menos que a requisição defina o header `Cookie`.
        const jar = this.collections.find(collectionId)?.manifest.cookies ?? [];
        const cookieHeader = cookieHeaderFor(jar, request.url);

        if (cookieHeader && !Object.keys(request.headers ?? {}).some((name) => name.toLowerCase() === 'cookie')) {
            request = { ...request, headers: { ...request.headers, Cookie: cookieHeader } };
        }

        this.set(key, { status: 'sending', requestId: request.id, startedAt: Date.now() });

        let result: HttpResult;

        try {
            result = await this.http.send(request);
        } catch (error) {
            result = failure(ipcErrorMessage(error));
        }

        const postLogs: HttpTimelineEntry[] = [];

        if (result.ok) {
            await this.storeCookies(collectionId, result.response.url || request.url, result.response.headers);

            for (const { origin, scripts } of scriptChain) {
                const postResponse = scripts.postResponse;

                if (postResponse?.trim() && decision?.action === 'skip') {
                    postLogs.push(this.scripts.skip('postResponse', { collectionId, path, definition: resolved, origin }));
                } else if (postResponse?.trim() && decision) {
                    const outcome = await this.scripts.run('postResponse', postResponse, { collectionId, path, definition: resolved, access: this, chain: [...chain, path], response: result.response, origin, permissions: decision.permissions });

                    postLogs.push(...outcome.logs);

                    // Um script com erro interrompe os seguintes (como no pre-request).
                    if (outcome.error) {
                        break;
                    }
                }
            }
        }

        result = withLogs(result, preLogs, postLogs);
        this.history.record(collectionId, path, request, result);

        // Ignora se, nesse meio-tempo, uma nova execução substituiu esta.
        const current = this.get(key);

        if (current?.status === 'sending' && current.requestId === request.id) {
            this.set(key, { status: 'done', result, receivedAt: Date.now() });
        }
    }

    /**
     * O que os pre-request mudaram na requisição: sem `readSecrets`, um campo definido por
     * script não pode depender de variável secreta (senão `setUrl('…?t={{token}}')` vazaria o
     * segredo); e uma troca de host vira aviso no console.
     */
    private async checkScriptChanges(
        collectionId: EntityId,
        path: string,
        original: RequestDefinition,
        scripted: RequestDefinition,
        resolved: RequestDefinition,
        chain: readonly string[],
        readSecrets: boolean
    ): Promise<{ error: string | null; warnings: HttpTimelineEntry[] }> {
        const before = scriptFields(original);
        const after = scriptFields(scripted);
        const changed = [...after.keys()].filter((label) => before.get(label) !== after.get(label));
        const warnings: HttpTimelineEntry[] = [];

        if (!changed.length) {
            return { error: null, warnings };
        }

        if (!readSecrets) {
            const masked = scriptFields((await this.templates.prepare(collectionId, path, scripted, this, [...chain, path], { preview: true, maskSecrets: true })).definition);
            const real = scriptFields(resolved);
            const leaking = changed.find((label) => real.get(label) !== masked.get(label));

            if (leaking) {
                return {
                    error: `A pre-request script set ${leaking} using a secret variable, which its permissions do not allow. Turn on "Read secret variables" in the collection's Security tab if you trust this script.`,
                    warnings
                };
            }
        }

        if (changed.includes('the URL')) {
            const from = hostOf((await this.templates.prepare(collectionId, path, original, this, [...chain, path], { preview: true })).definition.url);
            const to = hostOf(resolved.url);

            if (from && to && from !== to) {
                warnings.push({ kind: 'error', level: 'warn', text: `[Scripts] a pre-request script changed the destination of this request: ${from} → ${to}` });
            }
        }

        return { error: null, warnings };
    }

    /** Scripts herdados (coleção e pastas) seguidos dos da requisição, na ordem de execução. */
    private scriptChain(collectionId: EntityId, path: string, definition: RequestDefinition): Array<{ origin: string | null; scripts: NonNullable<RequestDefinition['scripts']> }> {
        const describe = (level: InheritanceLevel) => (level.kind === 'collection' ? 'collection' : `folder ${level.label}`);

        return [...this.templates.chain(collectionId, parentFolder(path)).map((level) => ({ origin: describe(level), scripts: level.scripts })), { origin: null, scripts: definition.scripts ?? {} }];
    }

    /** Guarda os `Set-Cookie` da resposta no `otto.yaml` da coleção. */
    private async storeCookies(collectionId: EntityId, url: string, headers: ReadonlyArray<[string, string]>): Promise<void> {
        const setCookies = headers.filter(([name]) => name.toLowerCase() === 'set-cookie').map(([, value]) => value);
        const current = this.collections.find(collectionId)?.manifest.cookies;

        if (!setCookies.length || !current) {
            return;
        }

        const cookies = applySetCookies(current, url, setCookies);

        if (JSON.stringify(cookies) !== JSON.stringify(current)) {
            await this.collections.updateManifest(collectionId, { cookies }).catch(() => undefined);
        }
    }

    /**
     * Requisição montada para gerar código. `resolve` interpola as variáveis; valores
     * secretos voltam a aparecer como `{{$.nome}}`. Não executa scripts nem envia
     * requisições referenciadas (usa só a última resposta delas).
     */
    async preview(collectionId: EntityId, path: string, definition: RequestDefinition, resolve: boolean): Promise<{ request: HttpRequest; problems: string[] }> {
        if (!resolve) {
            const collectionHeaders = this.collections.find(collectionId)?.manifest.headers ?? [];
            const effective = this.templates.withInheritedAuth(collectionId, path, definition);
            const request = buildHttpRequest({ ...effective, headers: [...collectionHeaders, ...effective.headers] }, { id: 'preview' });

            // Sem interpolar, `{{$.baseUrl}}/x` não ganha o `http://` padrão.
            return { request: /^\s*\{\{/.test(definition.url) ? { ...request, url: request.url.replace(/^http:\/\//, '') } : request, problems: [] };
        }

        const access: ResponseAccess = {
            lastResponse: (id, referenced) => this.lastResponse(id, referenced),
            sendReferenced: (id, referenced) => {
                const snapshot = this.lastResponse(id, referenced);

                return snapshot ? Promise.resolve(snapshot) : Promise.reject(new TemplateError(`${referenced} has no response yet: send it first`));
            }
        };
        const { definition: resolved, unresolved, errors } = await this.templates.prepare(collectionId, path, definition, access, [path]);
        const secrets = this.templates
            .scopes(collectionId, parentFolder(path))
            .entries()
            .filter((entry) => entry.secret && !entry.shadowed && entry.value.length >= 3)
            .sort((a, b) => b.value.length - a.value.length);
        const mask = (text: string): string => secrets.reduce((result, entry) => result.split(entry.value).join(`{{$.${entry.name}}}`), text);
        const request = buildHttpRequest(resolved, { id: 'preview' });

        return {
            request: {
                ...request,
                url: mask(request.url),
                headers: Object.fromEntries(Object.entries(request.headers ?? {}).map(([name, value]) => [name, mask(value)])),
                ...(request.body !== undefined && { body: mask(request.body) })
            },
            problems: [...unresolved.map((name) => `{{$.${name}}} is not defined`), ...errors]
        };
    }

    cancel(key: string): void {
        const entry = this.get(key);

        if (entry?.status === 'sending') {
            void this.http.cancel(entry.requestId);
        }
    }

    private describeProblems(collectionId: EntityId, path: string, unresolved: string[], errors: string[]): string {
        const lines = [...errors];

        if (unresolved.length) {
            const names = unresolved.map((name) => `{{$.${name}}}`).join(', ');
            const verb = unresolved.length > 1 ? 'are' : 'is';
            const scopes = this.templates.scopes(collectionId, parentFolder(path));

            lines.unshift(
                scopes.layers.length
                    ? `${names} ${verb} not defined in ${scopes.describe()}. Add ${unresolved.length > 1 ? 'them' : 'it'} in Environments, in the folder or in the collection variables.`
                    : `${names} ${verb} not defined: no environment is selected and the collection has no variables. Select one in the top bar (or create it in Environments).`
            );
        }

        return lines.join('\n');
    }

    private set(key: string, entry: ResponseEntry): void {
        this.entries.update((entries) => {
            const next = new Map(entries);

            next.delete(key);
            next.set(key, entry);

            for (const oldest of next.keys()) {
                if (next.size <= MAX_KEPT_RESPONSES) {
                    break;
                }

                next.delete(oldest);
            }

            return next;
        });
    }
}
