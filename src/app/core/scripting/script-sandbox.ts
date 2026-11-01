import type { QuickJSContext, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule } from 'quickjs-emscripten-core';

/**
 * Sandbox dos scripts de usuário: QuickJS compilado para WASM, num realm totalmente
 * separado do Angular. O script não enxerga `window`, `window.otto` (a ponte IPC), o DOM,
 * `fetch` nem timers: só o que é injetado aqui (`otto` e `console`), convertido em valores
 * do QuickJS. Funções do host recebem apenas dados (cópias JSON dos argumentos), então
 * não há caminho do script até objetos vivos do app (`constructor`, protótipos…).
 *
 * Limites: memória e pilha do runtime, tempo de CPU contínuo (cada trecho síncrono do
 * script) e total, e tempo de relógio da execução inteira (inclui esperas do host).
 */

export interface SandboxLimits {
    /** Tempo máximo de um trecho síncrono (entre dois `await` de valores do host). */
    sliceMs: number;
    /** Tempo de CPU total do script (soma dos trechos). */
    cpuMs: number;
    /** Tempo total, incluindo esperas por requisições referenciadas. */
    wallMs: number;
    memoryBytes: number;
    stackBytes: number;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = { sliceMs: 3_000, cpuMs: 10_000, wallMs: 120_000, memoryBytes: 64 * 1024 * 1024, stackBytes: 1024 * 1024 };

/** Profundidade máxima ao converter valores (evita estruturas patológicas). */
const MAX_DEPTH = 64;

/** Erro do script (mensagem já pronta para o console e a timeline). */
export type ScriptStopReason = 'error' | 'timeout' | 'memory' | 'never-settles';

export class ScriptError extends Error {
    constructor(
        message: string,
        /** Por que o script parou: exceção do próprio script ou limite do sandbox. */
        readonly reason: ScriptStopReason = 'error'
    ) {
        super(message);
    }
}

let modulePromise: Promise<QuickJSWASMModule> | null = null;

/** Carrega o QuickJS sob demanda (chunk separado; o WASM vem embutido no JS). */
export function loadQuickJS(): Promise<QuickJSWASMModule> {
    modulePromise ??= Promise.all([import('quickjs-emscripten-core'), import('@jitl/quickjs-singlefile-browser-release-sync')])
        .then(([core, variant]) => core.newQuickJSWASMModuleFromVariant(variant.default))
        .catch((error: unknown) => {
            modulePromise = null;

            throw error;
        });

    return modulePromise;
}

const OBJECT_PROTOS = new Set<unknown>([Object.prototype, Function.prototype, null]);

const isPlainObject = (value: object): boolean => OBJECT_PROTOS.has(Object.getPrototypeOf(value)) && typeof value !== 'function';

/** Dado puro (sem funções nem getters em lugar nenhum): pode ser copiado de uma vez. */
function isData(value: unknown, depth = 0): boolean {
    if (value === null || typeof value !== 'object') {
        return typeof value !== 'function';
    }

    if (depth > MAX_DEPTH) {
        return false;
    }

    if (value instanceof Date) {
        return true;
    }

    if (Array.isArray(value)) {
        return value.every((item) => isData(item, depth + 1));
    }

    if (!isPlainObject(value) || typeof (value as { then?: unknown }).then === 'function') {
        return false;
    }

    return Object.entries(Object.getOwnPropertyDescriptors(value)).every(([, descriptor]) => !descriptor.get && !descriptor.set && isData(descriptor.value, depth + 1));
}

/**
 * Membros que o script pode ver num objeto do host: as propriedades próprias enumeráveis
 * e os métodos/getters de classes (`HeaderList.get`), nunca `constructor`, `__proto__` ou
 * os membros de `Object.prototype`/`Function.prototype`.
 */
function exposedMembers(value: object): Array<[string, PropertyDescriptor]> {
    const members = new Map<string, PropertyDescriptor>();

    for (const key of Object.keys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);

        if (descriptor) {
            members.set(key, descriptor);
        }
    }

    for (let proto = Object.getPrototypeOf(value); !OBJECT_PROTOS.has(proto); proto = Object.getPrototypeOf(proto)) {
        for (const key of Object.getOwnPropertyNames(proto)) {
            const descriptor = Object.getOwnPropertyDescriptor(proto, key);

            if (key !== 'constructor' && !key.startsWith('__') && descriptor && !members.has(key) && (typeof descriptor.value === 'function' || descriptor.get)) {
                members.set(key, descriptor);
            }
        }
    }

    return [...members].filter(([key]) => key !== '__proto__' && key !== 'prototype');
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : typeof error === 'string' ? error : String(error));

/** Uma execução: runtime e contexto próprios, descartados no fim. */
class SandboxRun {
    private readonly owned: QuickJSHandle[] = [];
    private readonly cache = new Map<object, QuickJSHandle>();
    private pendingHost = 0;
    private wake: (() => void) | null = null;
    private alive = true;
    private cpuUsed = 0;
    private sliceStart = 0;
    private readonly startedAt = Date.now();

    constructor(
        private readonly runtime: QuickJSRuntime,
        private readonly ctx: QuickJSContext,
        private readonly limits: SandboxLimits
    ) {
        runtime.setMemoryLimit(limits.memoryBytes);
        runtime.setMaxStackSize(limits.stackBytes);
        runtime.setInterruptHandler(() => {
            const now = Date.now();

            return now - this.sliceStart > limits.sliceMs || this.cpuUsed + (now - this.sliceStart) > limits.cpuMs || now - this.startedAt > limits.wallMs;
        });
    }

    async run(code: string, globals: Record<string, unknown>): Promise<void> {
        for (const [name, value] of Object.entries(globals)) {
            this.ctx.setProp(this.ctx.global, name, this.toGuest(value, null, 0));
        }

        // Corpo de função assíncrona: `await` e `return` no topo funcionam como antes.
        const evaluated = this.slice(() => this.ctx.evalCode(`(async () => {\n"use strict";\n${code}\n})()`, 'script.js'));

        if (evaluated.error) {
            throw this.guestError(evaluated.error);
        }

        const promise = this.own(evaluated.value);

        for (;;) {
            const jobs = this.slice(() => this.runtime.executePendingJobs());

            if (jobs.error) {
                throw this.guestError(jobs.error);
            }

            const state = this.ctx.getPromiseState(promise);

            if (state.type === 'fulfilled') {
                if (!state.notAPromise) {
                    state.value.dispose();
                }

                return;
            }

            if (state.type === 'rejected') {
                throw this.guestError(state.error);
            }

            if (!this.pendingHost) {
                throw new ScriptError('The script is waiting for something that never finishes (timers such as setTimeout do not exist in scripts: use await otto.sleep(ms))', 'never-settles');
            }

            await this.nextHostSettle();

            if (Date.now() - this.startedAt > this.limits.wallMs) {
                throw new ScriptError(`The script took longer than ${Math.round(this.limits.wallMs / 1000)} s`, 'timeout');
            }
        }
    }

    dispose(): void {
        this.alive = false;
        this.wake?.();

        for (const handle of this.owned.reverse()) {
            if (handle.alive) {
                handle.dispose();
            }
        }

        this.ctx.dispose();
        this.runtime.dispose();
    }

    /** Executa um trecho do script contabilizando o tempo de CPU. */
    private slice<T>(work: () => T): T {
        this.sliceStart = Date.now();

        try {
            return work();
        } finally {
            this.cpuUsed += Date.now() - this.sliceStart;
        }
    }

    private nextHostSettle(): Promise<void> {
        return new Promise((resolve) => (this.wake = resolve));
    }

    private own(handle: QuickJSHandle): QuickJSHandle {
        this.owned.push(handle);

        return handle;
    }

    private guestError(handle: QuickJSHandle): ScriptError {
        const reason = this.stopReason(handle);

        return new ScriptError(this.describeGuestError(handle), reason);
    }

    private stopReason(handle: QuickJSHandle): ScriptStopReason {
        try {
            const dumped: unknown = this.ctx.dump(handle);
            const { name, message } = (dumped && typeof dumped === 'object' ? dumped : {}) as { name?: unknown; message?: unknown };

            return name === 'InternalError' && /interrupted/i.test(String(message)) ? 'timeout' : name === 'InternalError' && /out of memory/i.test(String(message)) ? 'memory' : 'error';
        } catch {
            return 'error';
        }
    }

    private describeGuestError(handle: QuickJSHandle): string {
        try {
            const dumped: unknown = this.ctx.dump(handle);

            if (dumped && typeof dumped === 'object') {
                const { name, message } = dumped as { name?: unknown; message?: unknown };

                if (name === 'InternalError' && /interrupted/i.test(String(message))) {
                    return `The script took too long and was stopped (limit: ${Math.round(this.limits.sliceMs / 1000)} s of continuous work, ${Math.round(this.limits.cpuMs / 1000)} s in total)`;
                }

                if (name === 'InternalError' && /out of memory/i.test(String(message))) {
                    return `The script used more than ${Math.round(this.limits.memoryBytes / 1024 / 1024)} MB of memory and was stopped`;
                }

                if (message !== undefined) {
                    return name && name !== 'Error' ? `${String(name)}: ${String(message)}` : String(message);
                }
            }

            return String(dumped);
        } catch {
            return 'The script failed';
        } finally {
            if (handle.alive) {
                handle.dispose();
            }
        }
    }

    /** Argumento vindo do script: só dados (cópia JSON feita dentro do QuickJS). */
    private fromGuest(handle: QuickJSHandle): unknown {
        return this.ctx.typeof(handle) === 'function' ? undefined : this.ctx.dump(handle);
    }

    /**
     * Valor do host → QuickJS. Dados são copiados; objetos do `otto` viram objetos com
     * funções/getters que chamam o host; promises viram promises do QuickJS.
     * `owner` é o `this` usado nas chamadas de métodos.
     */
    private toGuest(value: unknown, owner: object | null, depth: number): QuickJSHandle {
        const ctx = this.ctx;

        if (depth > MAX_DEPTH) {
            throw new Error('Value is too deeply nested');
        }

        switch (typeof value) {
            case 'undefined':
                return ctx.undefined;
            case 'boolean':
                return value ? ctx.true : ctx.false;
            case 'number':
                return this.own(ctx.newNumber(value));
            case 'string':
                return this.own(ctx.newString(value));
            case 'bigint':
                return this.own(ctx.newBigInt(value));
            case 'symbol':
                return ctx.undefined;
        }

        if (value === null) {
            return ctx.null;
        }

        const object = value as object;
        const cached = this.cache.get(object);

        if (cached?.alive) {
            return cached;
        }

        if (typeof (object as { then?: unknown }).then === 'function') {
            return this.promiseToGuest(object as PromiseLike<unknown>);
        }

        if (object instanceof Date) {
            return this.own(ctx.newString(Number.isNaN(object.getTime()) ? 'Invalid Date' : object.toISOString()));
        }

        if (ArrayBuffer.isView(object)) {
            return this.toGuest(Array.from(new Uint8Array(object.buffer, object.byteOffset, object.byteLength)), null, depth + 1);
        }

        if (Array.isArray(object)) {
            const array = this.own(ctx.newArray());

            this.cache.set(object, array);
            object.forEach((item, index) => ctx.setProp(array, index, this.toGuest(item, null, depth + 1)));

            return array;
        }

        const handle = typeof object === 'function' ? this.functionToGuest(object as (...args: unknown[]) => unknown, owner) : this.own(ctx.newObject());

        this.cache.set(object, handle);

        if (object instanceof Map) {
            for (const [key, item] of object) {
                ctx.setProp(handle, String(key), this.toGuest(item, null, depth + 1));
            }

            return handle;
        }

        if (isData(object)) {
            for (const [key, item] of Object.entries(object)) {
                ctx.setProp(handle, key, this.toGuest(item, null, depth + 1));
            }

            return handle;
        }

        for (const [key, descriptor] of exposedMembers(object)) {
            if (descriptor.get) {
                const getter = descriptor.get;

                ctx.defineProp(handle, key, {
                    enumerable: true,
                    configurable: true,
                    get: () => this.hostCall(() => getter.call(object), object, depth)
                });
            } else {
                ctx.setProp(handle, key, this.toGuest(descriptor.value, object, depth + 1));
            }
        }

        return handle;
    }

    private functionToGuest(fn: (...args: unknown[]) => unknown, owner: object | null): QuickJSHandle {
        // `fn.name` direto poderia ser um getter do `otto` (`otto.request.name`): só o valor próprio.
        const declared: unknown = Object.getOwnPropertyDescriptor(fn, 'name')?.value;

        return this.own(
            this.ctx.newFunction(typeof declared === 'string' && declared ? declared : 'fn', (...args) =>
                this.hostCall(
                    () =>
                        fn.apply(
                            owner ?? undefined,
                            args.map((arg) => this.fromGuest(arg))
                        ),
                    owner,
                    0
                )
            )
        );
    }

    /**
     * Chamada a código do host feita pelo script. Erros viram exceções no script (só
     * nome e mensagem). O valor devolvido é do QuickJS (que o libera), por isso uma
     * cópia própria (`dup`).
     */
    private hostCall(call: () => unknown, owner: object | null, depth: number): QuickJSHandle {
        const began = Date.now();

        try {
            const handle = this.toGuest(call(), owner, depth + 1);

            return handle.alive && handle.owner ? handle.dup() : handle;
        } catch (error) {
            throw new Error(messageOf(error));
        } finally {
            // Tempo gasto no host (ex.: JSONPath em respostas grandes) não conta como CPU do script.
            this.sliceStart += Date.now() - began;
        }
    }

    private promiseToGuest(promise: PromiseLike<unknown>): QuickJSHandle {
        const deferred = this.ctx.newPromise();

        this.pendingHost++;
        Promise.resolve(promise)
            .then(
                (result) => {
                    if (this.alive) {
                        deferred.resolve(this.toGuest(result, null, 0));
                    }
                },
                (error: unknown) => {
                    if (this.alive) {
                        const guestError = this.ctx.newError(messageOf(error));

                        deferred.reject(guestError);
                        guestError.dispose();
                    }
                }
            )
            .catch((error: unknown) => {
                // Falha ao converter o resultado: a promise do script é rejeitada.
                if (this.alive && deferred.alive) {
                    const guestError = this.ctx.newError(messageOf(error));

                    deferred.reject(guestError);
                    guestError.dispose();
                }
            })
            .finally(() => {
                this.pendingHost--;
                this.wake?.();
                this.wake = null;
            });

        return this.own(deferred.handle);
    }
}

/**
 * Executa `code` no sandbox com os globais informados (ex.: `otto`, `console`).
 * Lança `ScriptError` com a mensagem do script (exceção, tempo ou memória esgotados).
 */
export async function runSandboxed(code: string, globals: Record<string, unknown>, limits: SandboxLimits = DEFAULT_SANDBOX_LIMITS): Promise<void> {
    const quickjs = await loadQuickJS();
    const runtime = quickjs.newRuntime();
    const run = new SandboxRun(runtime, runtime.newContext(), limits);

    try {
        await run.run(code, globals);
    } finally {
        run.dispose();
    }
}
