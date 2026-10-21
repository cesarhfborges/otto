import { membersAfter, OTTO_CATALOG } from './catalog';
import type { ArgSpec, CatalogNode } from './node';

/** De onde vêm os dados de uma mensagem: requisição atual (`ref: null`) ou outra (`ref`). */
export interface MessageTarget {
    ref: string | null;
    kind: 'request' | 'response';
}

export type CompletionContext =
    /** Início da tag: variáveis, `otto` e atalhos. */
    | { type: 'root'; prefix: string; from: number }
    /** Depois de `$.`. */
    | { type: 'variable'; prefix: string; from: number }
    /** Depois de `otto.a.b.`: membros do nó. */
    | { type: 'member'; members: readonly CatalogNode[]; prefix: string; from: number; target: MessageTarget | null }
    /** Dentro dos parênteses de uma função (`quoted`: já dentro de aspas). */
    | { type: 'argument'; fn: CatalogNode; arg: ArgSpec | undefined; index: number; prefix: string; from: number; quoted: boolean; target: MessageTarget | null }
    /** Dentro de `{ … }` nas opções de `collection.request`: chaves ou valores de `send`. */
    | { type: 'option'; key: string | null; prefix: string; from: number; quoted: boolean }
    | { type: 'none' };

type Op = { kind: 'root'; name: string } | { kind: 'member'; name: string } | { kind: 'call'; firstArg: string | null } | { kind: 'index' };

interface Frame {
    type: 'top' | 'call' | 'object' | 'index';
    chain: Op[];
    callee: Op[];
    index: number;
    firstArg: string | null;
    key: string | null;
    afterColon: boolean;
}

interface Resolved {
    node: CatalogNode;
    called: boolean;
    target: MessageTarget | null;
}

/** Resolve uma cadeia `otto.…` no catálogo (ou `null` se sai do que é conhecido). */
function resolve(chain: readonly Op[]): Resolved | null {
    if (chain[0]?.kind !== 'root' || chain[0].name !== 'otto') {
        return null;
    }

    let node = OTTO_CATALOG;
    let called = false;
    let target: MessageTarget | null = null;
    let ref: string | null = null;
    const names: string[] = [];

    for (const op of chain.slice(1)) {
        if (op.kind === 'member') {
            const next = membersAfter(node, called).find((member) => member.name === op.name);

            if (!next) {
                return null;
            }

            names.push(op.name);
            node = next;
            called = false;

            if (names.join('.') === 'request') {
                target = { ref: null, kind: 'request' };
            } else if (names[0] === 'collection' && names.length === 3 && (op.name === 'response' || op.name === 'request')) {
                target = { ref, kind: op.name };
            }
        } else if (op.kind === 'call') {
            if (names.join('.') === 'collection.request') {
                ref = op.firstArg;
            }

            called = true;
        } else {
            return null;
        }
    }

    return { node, called, target };
}

/** Analisa o conteúdo da tag até o cursor (`before`) para saber o que sugerir. */
export function completionContext(before: string): CompletionContext {
    const stack: Frame[] = [{ type: 'top', chain: [], callee: [], index: 0, firstArg: null, key: null, afterColon: false }];
    const top = (): Frame => stack.at(-1)!;
    let pendingDot = false;
    let word: { text: string; start: number } | null = null;
    let openString: { text: string; start: number } | null = null;

    for (let i = 0; i < before.length; ) {
        const char = before[i]!;

        word = null;

        if (char === "'" || char === '"') {
            let j = i + 1;
            let text = '';

            for (; j < before.length && before[j] !== char; j++) {
                text += before[j] === '\\' ? (before[++j] ?? '') : before[j];
            }

            if (j >= before.length) {
                openString = { text, start: i + 1 };
                break;
            }

            const frame = top();

            if (frame.type === 'call' && frame.index === 0 && !frame.chain.length) {
                frame.firstArg = text;
            }

            if (frame.type === 'object' && !frame.afterColon) {
                frame.key = text;
            }

            frame.chain = [];
            i = j + 1;
            continue;
        }

        const identifier = /^[A-Za-z_][\w-]*/.exec(before.slice(i));

        if (identifier) {
            const frame = top();
            const name = identifier[0];

            if (pendingDot && frame.chain.length) {
                frame.chain.push({ kind: 'member', name });
            } else if (frame.type === 'object' && !frame.afterColon) {
                frame.key = name;
            } else {
                frame.chain = [{ kind: 'root', name }];
            }

            pendingDot = false;
            word = { text: name, start: i };
            i += name.length;
            continue;
        }

        pendingDot = false;

        switch (char) {
            case '.':
                pendingDot = true;
                break;
            case '$':
                top().chain = [{ kind: 'root', name: '$' }];
                break;
            case '(':
                stack.push({ type: 'call', chain: [], callee: top().chain, index: 0, firstArg: null, key: null, afterColon: false });
                break;
            case '{':
                stack.push({ type: 'object', chain: [], callee: [], index: 0, firstArg: null, key: null, afterColon: false });
                break;
            case '[':
                stack.push({ type: 'index', chain: [], callee: [], index: 0, firstArg: null, key: null, afterColon: false });
                break;
            case ',':
                top().index++;
                top().chain = [];
                top().key = null;
                top().afterColon = false;
                break;
            case ':':
                top().chain = [];
                top().afterColon = true;
                break;
            case ')':
            case '}':
            case ']': {
                const frame = stack.length > 1 ? stack.pop()! : top();

                if (char === ')') {
                    top().chain = [...frame.callee, { kind: 'call', firstArg: frame.firstArg }];
                } else {
                    top().chain = char === ']' ? [...top().chain, { kind: 'index' }] : [];
                }

                break;
            }
        }

        i++;
    }

    const frame = top();
    const prefix = openString?.text ?? word?.text ?? '';
    const from = openString?.start ?? word?.start ?? before.length;

    if (frame.type === 'object') {
        return { type: 'option', key: frame.afterColon ? frame.key : null, prefix, from, quoted: !!openString };
    }

    const chain = word && frame.chain.at(-1)?.kind === 'member' ? frame.chain.slice(0, -1) : frame.chain;

    if (!openString && (pendingDot || (word && frame.chain.length > 1))) {
        if (chain[0]?.kind === 'root' && chain[0].name === '$') {
            return { type: 'variable', prefix: pendingDot ? '' : prefix, from: pendingDot ? before.length : from };
        }

        const resolved = resolve(chain);

        return resolved ? { type: 'member', members: membersAfter(resolved.node, resolved.called), prefix: pendingDot ? '' : prefix, from: pendingDot ? before.length : from, target: resolved.target } : { type: 'none' };
    }

    if (frame.type === 'call' && (openString || !frame.chain.length || (word && frame.chain.length === 1))) {
        const callee = resolve(frame.callee);

        if (callee?.node.kind === 'function') {
            const spec = callee.node.args?.[frame.index] ?? callee.node.args?.find((item) => item.name.endsWith('…'));

            if (openString || !word || !'otto'.startsWith(word.text)) {
                return { type: 'argument', fn: callee.node, arg: spec, index: frame.index, prefix, from, quoted: !!openString, target: callee.target };
            }
        }
    }

    if (openString) {
        return { type: 'none' };
    }

    return { type: 'root', prefix, from };
}
