import { OTTO_CATALOG } from './catalog';
import { TemplateError, UnresolvedError } from './errors';
import { messageReader, type MessageSnapshot, type ReadGuard } from './message';
import type { CatalogNode } from './node';

export type SendPolicy = 'never' | 'empty' | 'expired' | 'always';

export interface RequestRefOptions {
    send: SendPolicy;
    maxAge?: number;
    /** Status esperado (`200`, `'2xx'`). */
    expect?: number | string;
}

export interface RequestIdentity {
    id: string | null;
    name: string;
    path: string;
    folder: string;
    method: string;
}

/** Outra requisição da coleção, vista pelo motor. */
export interface RequestRefHandle extends RequestIdentity {
    /** Definição interpolada no contexto dela. */
    request(): Promise<MessageSnapshot>;
    lastResponse(): MessageSnapshot | null;
    /** Envia e devolve a resposta (lança se falhar). */
    send(): Promise<MessageSnapshot>;
}

/** O que o motor precisa do app (inversão de dependência: o motor não conhece Angular nem IPC). */
export interface OttoHost {
    /** Preview (tooltips/autocomplete): nunca envia requisições nem pergunta nada ao usuário. */
    preview: boolean;
    collection: { id: string; name: string } | null;
    info: { environment: string | null; workspace: string | null; appVersion: string; platform: string };
    currentRequest: RequestIdentity | null;
    findRequest(ref: string): RequestRefHandle | null;
}

/** Objetos do próprio `otto` (membro inexistente é erro, não "valor não encontrado"). */
export const RUNTIME_OBJECTS = new WeakSet<object>();
/** Funções que recebem os argumentos sem avaliar (`otto.default`…). */
export const LAZY_FUNCTIONS = new WeakSet<object>();

const runtime = <T extends object>(value: T): T => (RUNTIME_OBJECTS.add(value), value);

/** Parte estática do `otto` (funções puras do catálogo), montada uma vez. */
function buildStatic(nodes: readonly CatalogNode[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    for (const node of nodes) {
        if (node.impl) {
            const impl = node.impl as (...args: unknown[]) => unknown;
            const callable = runtime((...args: unknown[]) => impl(...args));

            if (node.lazy) {
                LAZY_FUNCTIONS.add(callable);
            }

            out[node.name] = node.members ? Object.assign(callable, buildStatic(node.members)) : callable;
        } else if (node.kind === 'namespace' && node.members?.some((member) => member.impl)) {
            out[node.name] = runtime(buildStatic(node.members));
        }
    }

    return out;
}

const STATIC = buildStatic(OTTO_CATALOG.members ?? []);

/** Membros de `otto.request` sem chamar (a requisição atual). */
const CURRENT_REQUEST_MEMBERS = (OTTO_CATALOG.members ?? []).find((node) => node.name === 'request')?.members?.map((node) => node.name) ?? [];

const folderOf = (path: string): string => path.split('/').slice(0, -1).join('/');

function matchesExpectation(status: number, expect: number | string): boolean {
    const wanted = String(expect).toLowerCase();

    return /^\dxx$/.test(wanted) ? String(status)[0] === wanted[0] : status === Number(wanted);
}

function refOptions(raw: unknown): RequestRefOptions {
    const options = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const send = (options['send'] ?? 'empty') as SendPolicy;

    if (!['never', 'empty', 'expired', 'always'].includes(send)) {
        throw new TemplateError(`Invalid send policy "${String(send)}" (use never, empty, expired or always)`);
    }

    return { send, ...(options['maxAge'] !== undefined && { maxAge: Number(options['maxAge']) }), ...(options['expect'] !== undefined && { expect: options['expect'] as number | string }) };
}

/** Política de reenvio (`send`/`maxAge`) + `expect` sobre a última resposta guardada. */
async function responseOf(handle: RequestRefHandle, options: RequestRefOptions, host: OttoHost): Promise<MessageSnapshot> {
    let response = handle.lastResponse();
    const age = response?.receivedAt ? (Date.now() - Date.parse(response.receivedAt)) / 1000 : Infinity;
    const stale = options.send === 'always' || (options.send !== 'never' && !response) || (options.send === 'expired' && age > (options.maxAge ?? 0));

    if (stale && !host.preview) {
        response = await handle.send();
    }

    if (!response) {
        throw new UnresolvedError(`${handle.name} has no response yet — send it first`);
    }

    if (options.expect !== undefined && !matchesExpectation(response.status ?? 0, options.expect)) {
        throw new TemplateError(`${handle.name} returned ${response.status}`);
    }

    return response;
}

/**
 * Monta o objeto `otto` de uma avaliação. `currentRequest` dá a requisição atual já
 * interpolada; `guard` impede que o campo em avaliação leia a si mesmo.
 */
export function createOtto(host: OttoHost, currentRequest?: () => Promise<MessageSnapshot>, guard: ReadGuard = {}): object {
    const now = new Date();
    const identity = (value: RequestIdentity | null): Record<string, unknown> => ({ id: value?.id ?? '', name: value?.name ?? '', path: value?.path ?? '', folder: folderOf(value?.path ?? ''), method: value?.method ?? '' });

    const current = async (): Promise<Record<string, unknown>> => {
        if (!currentRequest) {
            throw new UnresolvedError('otto.request is not available here');
        }

        return runtime(messageReader(await currentRequest(), now, guard, identity(host.currentRequest)));
    };

    const requestRef = (ref: unknown, rawOptions?: unknown): object => {
        const handle = host.findRequest(String(ref ?? ''));

        if (!handle) {
            throw new TemplateError(`Request "${String(ref)}" not found in this collection`);
        }

        const options = refOptions(rawOptions);

        return runtime({
            ...identity(handle),
            hasResponse: handle.lastResponse() !== null,
            get response() {
                return responseOf(handle, options, host).then((snapshot) => runtime(messageReader(snapshot, now)));
            },
            get request() {
                return handle.request().then((snapshot) => runtime(messageReader(snapshot, now)));
            }
        });
    };

    // `otto.request('ref')` é outra requisição; `otto.request.x` lê a atual (sob demanda).
    const request = runtime(Object.defineProperties((ref: unknown, options?: unknown) => requestRef(ref, options), Object.fromEntries(CURRENT_REQUEST_MEMBERS.map((name) => [name, { enumerable: true, get: () => current().then((reader) => reader[name]) }]))));

    return runtime({
        ...STATIC,
        request,
        collection: runtime({ id: host.collection?.id ?? '', name: host.collection?.name ?? '' }),
        info: runtime({ environment: host.info.environment ?? '', collection: host.collection?.name ?? '', workspace: host.info.workspace ?? '', app: runtime({ version: host.info.appVersion }), platform: host.info.platform })
    });
}
