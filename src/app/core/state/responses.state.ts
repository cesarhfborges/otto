import { Injectable, inject, signal } from '@angular/core';
import { buildHttpRequest } from '@shared/http/build-request';
import { interpolateRequest, variablesFrom } from '@shared/http/interpolate';
import type { EntityId, HttpResult, RequestDefinition } from '@shared/models';
import { ipcErrorMessage } from '../bridge/ipc-error';
import { HttpGateway } from '../ports';
import { CollectionsState } from './collections.state';
import { EnvironmentsState } from './environments.state';

export type ResponseEntry = { status: 'sending'; requestId: string } | { status: 'done'; result: HttpResult };

/** Respostas guardadas em memória (corpos podem ser grandes); as mais antigas saem primeiro. */
const MAX_KEPT_RESPONSES = 20;

export const responseKey = (collectionId: EntityId, path: string): string => `${collectionId}:${path}`;

/**
 * Execuções das requisições abertas, por arquivo da coleção. Fica fora do
 * componente para a resposta sobreviver à troca de abas.
 */
@Injectable({ providedIn: 'root' })
export class ResponsesState {
    private readonly http = inject(HttpGateway);
    private readonly environments = inject(EnvironmentsState);
    private readonly collections = inject(CollectionsState);
    private readonly entries = signal<ReadonlyMap<string, ResponseEntry>>(new Map());

    get(key: string): ResponseEntry | undefined {
        return this.entries().get(key);
    }

    async send(collectionId: EntityId, path: string, definition: RequestDefinition): Promise<void> {
        const key = responseKey(collectionId, path);

        if (this.get(key)?.status === 'sending') {
            return;
        }

        // Variáveis do ambiente selecionado na coleção (da própria coleção ou global).
        const environment = this.environments.selected(collectionId);
        // Headers da coleção vêm antes: na montagem o último com o mesmo nome vence, então os da requisição têm prioridade.
        const collectionHeaders = this.collections.find(collectionId)?.manifest.headers ?? [];
        const withCollectionHeaders = { ...definition, headers: [...collectionHeaders, ...definition.headers] };
        const { definition: resolved, unresolved } = interpolateRequest(withCollectionHeaders, variablesFrom(environment?.variables ?? []));

        if (unresolved.length) {
            const names = unresolved.map((name) => `{{${name}}}`).join(', ');
            const verb = unresolved.length > 1 ? 'are' : 'is';
            const error = environment
                ? `${names} ${verb} not defined in the "${environment.name}" environment. Add ${unresolved.length > 1 ? 'them' : 'it'} in Environments or select another environment.`
                : `${names} ${verb} not defined: no environment is selected. Select one in the top bar (or create it in Environments).`;

            this.set(key, { status: 'done', result: { ok: false, error, code: 'UNRESOLVED_VARIABLES', timeMs: 0, timeline: [] } });

            return;
        }

        const request = buildHttpRequest(resolved, { id: crypto.randomUUID(), source: { collectionId, requestPath: path } });

        if (!request.url) {
            this.set(key, { status: 'done', result: { ok: false, error: 'Enter a URL to send this request.', code: 'MISSING_URL', timeMs: 0, timeline: [] } });

            return;
        }

        this.set(key, { status: 'sending', requestId: request.id });

        let result: HttpResult;

        try {
            result = await this.http.send(request);
        } catch (error) {
            result = { ok: false, error: ipcErrorMessage(error), timeMs: 0, timeline: [] };
        }

        // Ignora se, nesse meio-tempo, uma nova execução substituiu esta.
        const current = this.get(key);

        if (current?.status === 'sending' && current.requestId === request.id) {
            this.set(key, { status: 'done', result });
        }
    }

    cancel(key: string): void {
        const entry = this.get(key);

        if (entry?.status === 'sending') {
            void this.http.cancel(entry.requestId);
        }
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
