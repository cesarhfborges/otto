import type { CollectionCookie } from '@shared/models';
import type { ScriptInput, ScriptOutput } from './script-api';

/** Mensagens entre o app e o worker dos scripts (`script.worker.ts`). */

export type ScriptWorkerRequest = { type: 'run'; input: ScriptInput } | { type: 'rpc-result'; callId: number; ok: true; value: unknown } | { type: 'rpc-result'; callId: number; ok: false; error: string };

export type ScriptRpcCall = { method: 'response'; args: [ref: string, options: unknown] } | { method: 'request'; args: [ref: string] } | { method: 'saveCookies'; args: [cookies: CollectionCookie[]] };

export type ScriptWorkerMessage = ({ type: 'rpc'; callId: number } & ScriptRpcCall) | { type: 'done'; output: ScriptOutput } | { type: 'failed'; error: string };
