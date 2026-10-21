import { Injectable, inject, signal } from '@angular/core';
import { buildHttpRequest } from '@shared/http/build-request';
import type { EntityId, HttpResult, RequestDefinition } from '@shared/models';
import { responseSnapshot, TemplateError, type MessageSnapshot } from '@shared/templating';
import { ipcErrorMessage } from '../bridge/ipc-error';
import { HttpGateway } from '../ports';
import { TemplateContextService, type ResponseAccess } from '../templating/template-context.service';

export type ResponseEntry = { status: 'sending'; requestId: string } | { status: 'done'; result: HttpResult; receivedAt: number };

/** Respostas guardadas em memória (corpos podem ser grandes); as mais antigas saem primeiro. */
const MAX_KEPT_RESPONSES = 20;

export const responseKey = (collectionId: EntityId, path: string): string => `${collectionId}:${path}`;

const failure = (error: string, code?: string): HttpResult => ({ ok: false, error, ...(code && { code }), timeMs: 0, timeline: [] });

/**
 * Execuções das requisições abertas, por arquivo da coleção. Fica fora do
 * componente para a resposta sobreviver à troca de abas. Também atende o motor de
 * templates (`otto.collection.request(…)`): última resposta e envio sob demanda.
 */
@Injectable({ providedIn: 'root' })
export class ResponsesState implements ResponseAccess {
    private readonly http = inject(HttpGateway);
    private readonly templates = inject(TemplateContextService);
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

    /** `chain`: requisições que dependem desta (envio em cascata), para detectar ciclos. */
    async send(collectionId: EntityId, path: string, definition: RequestDefinition, chain: readonly string[] = []): Promise<void> {
        const key = responseKey(collectionId, path);

        if (this.get(key)?.status === 'sending') {
            return;
        }

        if (chain.includes(path)) {
            throw new TemplateError(`Circular reference between requests: ${[...chain, path].join(' → ')}`);
        }

        const { definition: resolved, unresolved, errors } = await this.templates.prepare(collectionId, path, definition, this, [...chain, path]);

        if (unresolved.length || errors.length) {
            this.set(key, { status: 'done', result: failure(this.describeProblems(collectionId, unresolved, errors), unresolved.length ? 'UNRESOLVED_VARIABLES' : 'TEMPLATE_ERROR'), receivedAt: Date.now() });

            return;
        }

        const request = buildHttpRequest(resolved, { id: crypto.randomUUID(), source: { collectionId, requestPath: path } });

        if (!request.url) {
            this.set(key, { status: 'done', result: failure('Enter a URL to send this request.', 'MISSING_URL'), receivedAt: Date.now() });

            return;
        }

        this.set(key, { status: 'sending', requestId: request.id });

        let result: HttpResult;

        try {
            result = await this.http.send(request);
        } catch (error) {
            result = failure(ipcErrorMessage(error));
        }

        // Ignora se, nesse meio-tempo, uma nova execução substituiu esta.
        const current = this.get(key);

        if (current?.status === 'sending' && current.requestId === request.id) {
            this.set(key, { status: 'done', result, receivedAt: Date.now() });
        }
    }

    cancel(key: string): void {
        const entry = this.get(key);

        if (entry?.status === 'sending') {
            void this.http.cancel(entry.requestId);
        }
    }

    private describeProblems(collectionId: EntityId, unresolved: string[], errors: string[]): string {
        const lines = [...errors];

        if (unresolved.length) {
            const names = unresolved.map((name) => `{{$.${name}}}`).join(', ');
            const verb = unresolved.length > 1 ? 'are' : 'is';
            const scopes = this.templates.scopes(collectionId);

            lines.unshift(
                scopes.layers.length
                    ? `${names} ${verb} not defined in ${scopes.describe()}. Add ${unresolved.length > 1 ? 'them' : 'it'} in Environments or in the collection variables.`
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
