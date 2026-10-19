import { Injectable, inject, signal } from '@angular/core';
import { buildHttpRequest } from '@shared/http/build-request';
import type { EntityId, HttpResult, RequestDefinition } from '@shared/models';
import { ipcErrorMessage } from '../bridge/ipc-error';
import { HttpGateway } from '../ports';

export type ResponseEntry = { status: 'sending'; requestId: string } | { status: 'done'; result: HttpResult };

/** Respostas guardadas em memória (corpos podem ser grandes); as mais antigas saem primeiro. */
const MAX_KEPT_RESPONSES = 20;

const UNRESOLVED_VARIABLE = /\{\{\s*([^}]*?)\s*\}\}/g;

export const responseKey = (collectionId: EntityId, path: string): string => `${collectionId}:${path}`;

/**
 * Execuções das requisições abertas, por arquivo da coleção. Fica fora do
 * componente para a resposta sobreviver à troca de abas.
 */
@Injectable({ providedIn: 'root' })
export class ResponsesState {
    private readonly http = inject(HttpGateway);
    private readonly entries = signal<ReadonlyMap<string, ResponseEntry>>(new Map());

    get(key: string): ResponseEntry | undefined {
        return this.entries().get(key);
    }

    async send(collectionId: EntityId, path: string, definition: RequestDefinition): Promise<void> {
        const key = responseKey(collectionId, path);

        if (this.get(key)?.status === 'sending') {
            return;
        }

        const request = buildHttpRequest(definition, { id: crypto.randomUUID(), source: { collectionId, requestPath: path } });
        const variables = [...new Set([...request.url.matchAll(UNRESOLVED_VARIABLE)].map((match) => match[1]))];

        if (variables.length) {
            this.set(key, { status: 'done', result: { ok: false, error: `Unresolved variables in the URL: ${variables.join(', ')}. Variable interpolation arrives with the request editor.`, timeMs: 0 } });

            return;
        }

        if (!request.url) {
            this.set(key, { status: 'done', result: { ok: false, error: 'Enter a URL to send this request.', timeMs: 0 } });

            return;
        }

        this.set(key, { status: 'sending', requestId: request.id });

        let result: HttpResult;

        try {
            result = await this.http.send(request);
        } catch (error) {
            result = { ok: false, error: ipcErrorMessage(error), timeMs: 0 };
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
