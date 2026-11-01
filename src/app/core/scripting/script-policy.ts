import { javascriptLanguage } from '@codemirror/lang-javascript';

export interface ScriptViolation {
    from: number;
    to: number;
    message: string;
}

/**
 * Globais do navegador/Node que **não existem** no sandbox dos scripts (QuickJS, ver
 * `script-sandbox.ts`). Não é uma barreira de segurança — o isolamento é o próprio
 * sandbox —, só um aviso no editor antes de o script falhar com `ReferenceError`.
 */
const UNAVAILABLE_GLOBALS: Record<string, string> = Object.fromEntries(
    Object.entries({
        'there is no window or DOM in scripts': ['window', 'self', 'top', 'parent', 'frames', 'opener', 'document', 'customElements', 'DOMParser'],
        'scripts cannot open dialogs or windows': ['alert', 'confirm', 'prompt', 'print', 'open', 'close', 'showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker'],
        'scripts send requests only through otto (otto.request(…))': ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'RTCPeerConnection'],
        'scripts cannot read the app state': ['navigator', 'location', 'history', 'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookieStore'],
        'there are no timers in scripts: use await otto.sleep(ms)': ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'requestIdleCallback'],
        'scripts cannot start background code': ['Worker', 'SharedWorker', 'BroadcastChannel', 'MessageChannel', 'postMessage', 'importScripts', 'WebAssembly'],
        'Node.js/Electron APIs do not exist in scripts': ['require', 'process', 'module', 'exports', 'global', 'Buffer', '__dirname', '__filename'],
        'use otto.base64, otto.hash, otto.hmac or otto.uuid instead': ['crypto', 'atob', 'btoa', 'TextEncoder', 'TextDecoder', 'structuredClone']
    }).flatMap(([reason, names]) => names.map((name) => [name, reason]))
);

type SyntaxNode = ReturnType<typeof javascriptLanguage.parser.parse>['topNode'];

const text = (code: string, node: SyntaxNode) => code.slice(node.from, node.to);

/** Análise estática: globais inexistentes no sandbox e `import()`/`import`. */
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
                const reason = Object.hasOwn(UNAVAILABLE_GLOBALS, name) && !declared.has(name) ? UNAVAILABLE_GLOBALS[name] : null;

                if (reason) {
                    found.push({ from: node.from, to: node.to, message: `'${name}' is not available: ${reason}.` });
                }
            } else if (ref.name === 'DynamicImport' || ref.name === 'ImportDeclaration') {
                found.push({ from: node.from, to: node.firstChild?.to ?? node.to, message: 'Scripts cannot import modules.' });
            }
        }
    });

    return found;
}

/** O que um script parece usar (indicativo: as permissões valem na execução). */
export type ScriptCapability = 'modifyRequest' | 'writeVariables' | 'writeCookies' | 'sendRequests' | 'readVariables';

const CAPABILITY_PATTERNS: ReadonlyArray<[ScriptCapability, RegExp]> = [
    ['modifyRequest', /^otto\.request\.(set|add|remove)\w*$/],
    ['writeVariables', /^otto\.(environment|collectionVariables)\.(set|unset)$/],
    ['writeCookies', /^otto\.cookies\.(set|remove|clear)$/],
    ['sendRequests', /^otto\.request$/],
    ['readVariables', /^otto\.(environment|variables)\.(get|all)$/]
];

/** Análise estática das chamadas `otto.*` (ignora comentários e textos). */
export function scriptCapabilities(code: string): Set<ScriptCapability> {
    const found = new Set<ScriptCapability>();
    const tree = javascriptLanguage.parser.parse(code);

    tree.iterate({
        enter: (ref) => {
            if (ref.name !== 'CallExpression') {
                return;
            }

            const callee = ref.node.firstChild;
            const name = callee ? code.slice(callee.from, callee.to).replace(/\s+/g, '').replace(/\?\./g, '.') : '';

            for (const [capability, pattern] of CAPABILITY_PATTERNS) {
                if (pattern.test(name)) {
                    found.add(capability);
                }
            }
        }
    });

    return found;
}
