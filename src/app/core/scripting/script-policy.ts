import { javascriptLanguage } from '@codemirror/lang-javascript';

export interface ScriptViolation {
    from: number;
    to: number;
    message: string;
}

/**
 * Globais que o script não pode usar. O `window.otto` do preload é a ponte IPC (arquivos,
 * coleções…): qualquer caminho até o objeto global (`window`, `globalThis`, `self`, `top`…)
 * a expõe, além de UI bloqueante, rede fora do `otto`, armazenamento do app e execução
 * de código dinâmico.
 */
const BLOCKED_GLOBALS: Record<string, string> = Object.fromEntries(
    Object.entries({
        'gives access to the global object (and the app bridge)': ['window', 'self', 'globalThis', 'top', 'parent', 'frames', 'opener', 'document', 'customElements'],
        'opens a blocking dialog or window': ['alert', 'confirm', 'prompt', 'print', 'open', 'close', 'stop', 'focus', 'blur', 'showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker'],
        'runs dynamic code': ['eval', 'Function', 'importScripts', 'WebAssembly'],
        'makes requests outside otto': ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'RTCPeerConnection'],
        'reads or changes the app state': ['navigator', 'location', 'history', 'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookieStore', 'origin'],
        'starts background code': ['Worker', 'SharedWorker', 'BroadcastChannel', 'MessageChannel', 'postMessage', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback', 'queueMicrotask'],
        'is a Node.js/Electron global': ['require', 'process', 'module', 'exports', 'global', 'Buffer', '__dirname', '__filename']
    }).flatMap(([reason, names]) => names.map((name) => [name, reason]))
);

/** Propriedades que levam ao construtor `Function` ou ao protótipo (`(() => {}).constructor('…')`). */
const BLOCKED_PROPERTIES = new Set(['constructor', '__proto__', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']);

/** Nomes que podem virar parâmetros `undefined` na execução (`eval` não pode em strict mode). */
export const SHADOWED_GLOBALS = Object.keys(BLOCKED_GLOBALS).filter((name) => name !== 'eval');

type SyntaxNode = ReturnType<typeof javascriptLanguage.parser.parse>['topNode'];

const text = (code: string, node: SyntaxNode) => code.slice(node.from, node.to);

const unquote = (literal: string) => (/^(['"`]).*\1$/s.test(literal) ? literal.slice(1, -1) : null);

/** Análise estática: usos de globais/propriedades bloqueados e `import()`. */
export function checkScript(code: string): ScriptViolation[] {
    const tree = javascriptLanguage.parser.parse(code);
    const declared = new Set<string>();
    const found: ScriptViolation[] = [];

    // Um nome declarado no script (`const open = …`) é local, não o global.
    tree.iterate({
        enter: (ref) => {
            if (ref.name === 'VariableDefinition') {
                declared.add(text(code, ref.node));
            }
        }
    });

    tree.iterate({
        enter: (ref) => {
            const node = ref.node;

            if (ref.name === 'VariableName') {
                const name = text(code, node);
                const reason = Object.hasOwn(BLOCKED_GLOBALS, name) && !declared.has(name) ? BLOCKED_GLOBALS[name] : null;

                if (reason) {
                    found.push({ from: node.from, to: node.to, message: `'${name}' is not allowed in scripts: it ${reason}.` });
                }
            } else if (ref.name === 'PropertyName' && node.parent?.name === 'MemberExpression' && BLOCKED_PROPERTIES.has(text(code, node))) {
                found.push({ from: node.from, to: node.to, message: `'${text(code, node)}' is not allowed in scripts.` });
            } else if ((ref.name === 'String' || ref.name === 'TemplateString') && node.parent?.name === 'MemberExpression' && node.prevSibling?.name === '[') {
                const name = unquote(text(code, node));

                if (name !== null && BLOCKED_PROPERTIES.has(name)) {
                    found.push({ from: node.from, to: node.to, message: `'${name}' is not allowed in scripts.` });
                }
            } else if (ref.name === 'DynamicImport') {
                found.push({ from: node.from, to: node.firstChild?.to ?? node.to, message: "'import()' is not allowed in scripts." });
            }
        }
    });

    return found;
}

/** Posição legível (`linha:coluna`) para mensagens de erro na execução. */
export function describeViolation(code: string, violation: ScriptViolation): string {
    const before = code.slice(0, violation.from).split('\n');

    return `${violation.message} (line ${before.length}, column ${before[before.length - 1].length + 1})`;
}
