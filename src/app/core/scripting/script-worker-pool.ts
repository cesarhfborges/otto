import { Injectable } from '@angular/core';
import type { ScriptInput, ScriptOutput } from './script-api';
import type { ScriptRpcCall, ScriptWorkerMessage, ScriptWorkerRequest } from './script-worker-protocol';

/** Workers ao mesmo tempo (envios em paralelo); os demais scripts esperam na fila. */
const MAX_WORKERS = 4;
/** Folga sobre o tempo total do script antes de encerrar o worker à força. */
const KILL_GRACE_MS = 2_000;

type RpcHandler = (call: ScriptRpcCall) => Promise<unknown>;

/**
 * Workers dos scripts (`script.worker.ts`). Cada worker roda um script por vez e é
 * reaproveitado; se o script passar do tempo total, o worker é encerrado (`terminate`)
 * mesmo que o QuickJS não devolva o controle, e um novo é criado no próximo uso.
 */
@Injectable({ providedIn: 'root' })
export class ScriptWorkerPool {
    private readonly idle: Worker[] = [];
    private busy = 0;
    private readonly queue: Array<() => void> = [];

    async run(input: ScriptInput, rpc: RpcHandler): Promise<ScriptOutput> {
        const worker = await this.acquire();
        let healthy = true;

        try {
            return await new Promise<ScriptOutput>((resolve, reject) => {
                const timer = setTimeout(() => {
                    healthy = false;
                    reject(new ScriptTimeoutError(`The script took longer than ${Math.round(input.limits.wallMs / 1000)} s and was stopped`));
                }, input.limits.wallMs + KILL_GRACE_MS);

                const reply = (message: ScriptWorkerRequest) => worker.postMessage(message);

                worker.onmessage = ({ data }: MessageEvent<ScriptWorkerMessage>) => {
                    if (data.type === 'rpc') {
                        rpc(data).then(
                            (value) => reply({ type: 'rpc-result', callId: data.callId, ok: true, value }),
                            (error: unknown) => reply({ type: 'rpc-result', callId: data.callId, ok: false, error: error instanceof Error ? error.message : String(error) })
                        );

                        return;
                    }

                    clearTimeout(timer);

                    if (data.type === 'done') {
                        resolve(data.output);
                    } else {
                        healthy = false;
                        reject(new Error(data.error));
                    }
                };

                worker.onerror = (event) => {
                    clearTimeout(timer);
                    healthy = false;
                    reject(new Error(event.message || 'The script worker failed'));
                };

                reply({ type: 'run', input });
            });
        } finally {
            this.release(worker, healthy);
        }
    }

    private acquire(): Promise<Worker> {
        if (this.busy < MAX_WORKERS) {
            this.busy++;

            return Promise.resolve(this.idle.pop() ?? new Worker(new URL('./script.worker', import.meta.url), { type: 'module' }));
        }

        return new Promise((resolve) => this.queue.push(() => resolve(this.acquire())));
    }

    private release(worker: Worker, healthy: boolean): void {
        worker.onmessage = null;
        worker.onerror = null;

        if (healthy) {
            this.idle.push(worker);
        } else {
            worker.terminate();
        }

        this.busy--;
        this.queue.shift()?.();
    }
}

/** O worker foi encerrado por passar do tempo total. */
export class ScriptTimeoutError extends Error {}
