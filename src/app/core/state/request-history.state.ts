import { effect, inject, Injectable, signal } from '@angular/core';
import type { EntityId, HttpMethod, HttpRequest, HttpResult } from '@shared/models';
import { TabsState } from './tabs.state';

/** Execuções guardadas por aba; as mais antigas saem primeiro. */
const MAX_RUNS_PER_TAB = 50;

/** Corpos maiores que isto não são guardados (só os metadados), para conter o uso de memória. */
const MAX_BODY_CHARS = 512 * 1024;

/** Uma execução da requisição, com o que foi enviado e recebido. */
export interface HistoryRun {
    id: string;
    executedAt: number;
    method: HttpMethod;
    url: string;
    /** `null` quando a requisição falhou antes de receber resposta (rede, timeout, cancelamento). */
    status: number | null;
    error: string | null;
    timeMs: number;
    sizeBytes: number;
    request: {
        method: HttpMethod;
        url: string;
        headers: Array<[string, string]>;
        /** `null` sem corpo em texto (arquivo, multipart) ou acima do limite. */
        body: string | null;
    };
    response: {
        status: number;
        statusText: string;
        headers: Array<[string, string]>;
        contentType: string | null;
        /** `null` para conteúdo binário ou acima do limite. */
        body: string | null;
    } | null;
}

const bodyText = (text: string | undefined): string | null => (text === undefined || text.length > MAX_BODY_CHARS ? null : text);

const newId = (): string => globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Histórico de execuções de cada aba de requisição. Fica só em memória, de propósito
 * (requisições e respostas podem conter dados sensíveis): nunca vai para disco, banco
 * ou IPC. Some ao fechar a aba ou o app; reabrir a aba começa um histórico vazio.
 */
@Injectable({ providedIn: 'root' })
export class RequestHistoryState {
    private readonly tabs = inject(TabsState);
    private readonly runs = signal<ReadonlyMap<EntityId, readonly HistoryRun[]>>(new Map());

    constructor() {
        // Aba fechada (ou workspace/coleção trocados): o histórico dela é descartado.
        effect(() => {
            const open = new Set(this.tabs.tabs().map((tab) => tab.id));

            if ([...this.runs().keys()].some((id) => !open.has(id))) {
                this.runs.update((runs) => new Map([...runs].filter(([id]) => open.has(id))));
            }
        });
    }

    /** Execuções da aba aberta para a requisição, da mais recente para a mais antiga. */
    list(collectionId: EntityId, path: string): readonly HistoryRun[] {
        const tabId = this.tabId(collectionId, path);

        return (tabId && this.runs().get(tabId)) || [];
    }

    /** Registra uma execução; sem aba aberta para a requisição (ex.: envio em cascata), nada é guardado. */
    record(collectionId: EntityId, path: string, request: HttpRequest, result: HttpResult): void {
        const tabId = this.tabId(collectionId, path);

        if (!tabId) {
            return;
        }

        const run: HistoryRun = {
            id: newId(),
            executedAt: Date.now(),
            method: request.method,
            url: request.url,
            status: result.ok ? result.response.status : null,
            error: result.ok ? null : result.error,
            timeMs: result.ok ? result.response.timeMs : result.timeMs,
            sizeBytes: result.ok ? result.response.size : 0,
            request: { method: request.method, url: request.url, headers: Object.entries(request.headers ?? {}), body: bodyText(request.body) },
            response: result.ok
                ? {
                      status: result.response.status,
                      statusText: result.response.statusText,
                      headers: [...result.response.headers],
                      contentType: result.response.contentType,
                      body: result.response.bodyEncoding === 'utf8' ? bodyText(result.response.body) : null
                  }
                : null
        };

        this.runs.update((runs) => new Map(runs).set(tabId, [run, ...(runs.get(tabId) ?? [])].slice(0, MAX_RUNS_PER_TAB)));
    }

    remove(collectionId: EntityId, path: string, runId: string): void {
        const tabId = this.tabId(collectionId, path);

        if (tabId) {
            this.runs.update((runs) => new Map(runs).set(tabId, (runs.get(tabId) ?? []).filter((run) => run.id !== runId)));
        }
    }

    clear(collectionId: EntityId, path: string): void {
        const tabId = this.tabId(collectionId, path);

        if (tabId) {
            this.runs.update((runs) => {
                const next = new Map(runs);

                next.delete(tabId);

                return next;
            });
        }
    }

    private tabId(collectionId: EntityId, path: string): EntityId | null {
        return this.tabs.tabs().find((tab) => tab.kind === 'request' && tab.collectionId === collectionId && tab.resourceRef === path)?.id ?? null;
    }
}
