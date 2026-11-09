/// <reference lib="webworker" />

import type { MessageSnapshot } from '@shared/templating';
import { errorMessage, runScript } from './script-api';
import type { ScriptRpcCall, ScriptWorkerMessage, ScriptWorkerRequest } from './script-worker-protocol';

/**
 * Worker dos scripts: roda o QuickJS fora da thread da interface (um script pesado não
 * trava o Otto) e pode ser encerrado à força pelo app (`terminate`). Um script por vez.
 */

const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let nextCall = 1;

const post = (message: ScriptWorkerMessage) => postMessage(message);

function call<T>(rpc: ScriptRpcCall): Promise<T> {
    const callId = nextCall++;

    return new Promise<T>((resolve, reject) => {
        pending.set(callId, { resolve: resolve as (value: unknown) => void, reject });
        post({ type: 'rpc', callId, ...rpc });
    });
}

addEventListener('message', ({ data }: MessageEvent<ScriptWorkerRequest>) => {
    if (data.type === 'rpc-result') {
        const waiting = pending.get(data.callId);

        pending.delete(data.callId);

        if (data.ok) {
            waiting?.resolve(data.value);
        } else {
            waiting?.reject(new Error(data.error));
        }

        return;
    }

    runScript(data.input, {
        response: (ref, options) => call<MessageSnapshot>({ method: 'response', args: [ref, options] }),
        request: (ref) => call<MessageSnapshot>({ method: 'request', args: [ref] }),
        saveCookies: (cookies) => call<void>({ method: 'saveCookies', args: [cookies] })
    }).then(
        (output) => post({ type: 'done', output }),
        (error: unknown) => post({ type: 'failed', error: errorMessage(error) })
    );
});
