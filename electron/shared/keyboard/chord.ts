/**
 * Combinações de teclas ("chords") normalizadas, compartilhadas pelo main (menu
 * nativo) e pelo renderer (atalhos). Funções puras, sem DOM nem Electron.
 *
 * Formato canônico: modificadores na ordem `Mod`, `Ctrl`, `Alt`, `Shift`, `Meta`
 * seguidos da tecla, separados por `+` (ex.: `Mod+Shift+T`, `Ctrl+F4`, `F2`).
 * `Mod` é `Cmd` no macOS e `Ctrl` nos demais; fora do macOS `Ctrl` vira `Mod`.
 */

/** Combinação normalizada, ex.: `Mod+Shift+T`. */
export type KeyChord = string;

const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta'] as const;

type Modifier = (typeof MODIFIER_ORDER)[number];

/** Teclas que só modificam outra (não formam um atalho sozinhas). */
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS', 'Hyper', 'Super', 'CapsLock', 'Fn', 'FnLock', 'NumLock', 'ScrollLock']);

/** Nomes alternativos aceitos ao ler um chord digitado/salvo. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
    esc: 'Escape',
    escape: 'Escape',
    del: 'Delete',
    delete: 'Delete',
    enter: 'Enter',
    return: 'Enter',
    space: 'Space',
    tab: 'Tab',
    backspace: 'Backspace',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    home: 'Home',
    end: 'End',
    insert: 'Insert',
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    arrowup: 'ArrowUp',
    arrowdown: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
    plus: '+'
};

/** Subconjunto de `KeyboardEvent` usado aqui (o main não tem a lib DOM). */
export interface KeyboardEventLike {
    key: string;
    code: string;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
}

function modifierOf(token: string, mac: boolean): Modifier | null {
    switch (token.toLowerCase()) {
        case 'mod':
        case 'cmdorctrl':
        case 'commandorcontrol':
            return 'Mod';
        case 'ctrl':
        case 'control':
            return mac ? 'Ctrl' : 'Mod';
        case 'cmd':
        case 'command':
        case 'meta':
        case 'super':
        case 'win':
            return mac ? 'Mod' : 'Meta';
        case 'alt':
        case 'option':
            return 'Alt';
        case 'shift':
            return 'Shift';
        default:
            return null;
    }
}

function normalizeKey(token: string): string | null {
    if (!token) {
        return null;
    }

    if (token.length === 1) {
        return token === ' ' ? 'Space' : token.toUpperCase();
    }

    const alias = KEY_ALIASES[token.toLowerCase()];

    if (alias) {
        return alias;
    }

    if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(token)) {
        return token.toUpperCase();
    }

    return MODIFIER_KEYS.has(token) ? null : token;
}

function compose(modifiers: ReadonlySet<Modifier>, key: string): KeyChord {
    return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join('+');
}

/** Lê um chord em texto livre (`ctrl+shift+t`, `Cmd+,`, `Mod++`). `null` se inválido. */
export function normalizeChord(text: string, mac: boolean): KeyChord | null {
    const trimmed = text.trim();

    if (!trimmed) {
        return null;
    }

    // `Mod++` (a tecla é o próprio "+"): separa a tecla antes de dividir.
    const plusKey = trimmed.endsWith('++') || trimmed === '+';
    const parts = (plusKey ? trimmed.slice(0, -1) : trimmed).split('+').filter(Boolean);
    const keyToken = plusKey ? '+' : parts.pop();
    const modifiers = new Set<Modifier>();

    for (const part of parts) {
        const modifier = modifierOf(part.trim(), mac);

        if (!modifier || modifiers.has(modifier)) {
            return null;
        }

        modifiers.add(modifier);
    }

    const key = keyToken === undefined ? null : normalizeKey(keyToken.trim() || keyToken);

    return key ? compose(modifiers, key) : null;
}

/** Nome da tecla de um evento: letras/dígitos pela posição física (`code`), o resto por `key`. */
function eventKey(event: KeyboardEventLike): string | null {
    const { code, key } = event;

    if (/^Key[A-Z]$/.test(code)) {
        return code.slice(3);
    }

    if (/^Digit[0-9]$/.test(code)) {
        return code.slice(5);
    }

    if (/^Numpad[0-9]$/.test(code)) {
        return code.slice(6);
    }

    // `?` é Shift + `/` (US, ABNT2): o Shift já vira modificador, então a tecla é `/`.
    if (key === '?') {
        return '/';
    }

    if (!key || key === 'Dead' || key === 'Unidentified' || key === 'Process' || MODIFIER_KEYS.has(key)) {
        return null;
    }

    return normalizeKey(key);
}

/** Chord de um `keydown`; `null` para teclas só modificadoras ou sem nome. */
export function eventToChord(event: KeyboardEventLike, mac: boolean): KeyChord | null {
    const key = eventKey(event);

    if (!key) {
        return null;
    }

    const modifiers = new Set<Modifier>();

    if (mac ? event.metaKey : event.ctrlKey) {
        modifiers.add('Mod');
    }

    if (mac && event.ctrlKey) {
        modifiers.add('Ctrl');
    }

    if (!mac && event.metaKey) {
        modifiers.add('Meta');
    }

    if (event.altKey) {
        modifiers.add('Alt');
    }

    if (event.shiftKey) {
        modifiers.add('Shift');
    }

    return compose(modifiers, key);
}

/** Modificadores pressionados num evento, para a prévia durante a gravação ("Ctrl + Shift + …"). */
export function eventModifiers(event: KeyboardEventLike, mac: boolean): string[] {
    const held: Modifier[] = [];

    if (mac ? event.metaKey : event.ctrlKey) {
        held.push('Mod');
    }

    if (mac && event.ctrlKey) {
        held.push('Ctrl');
    }

    if (event.altKey) {
        held.push('Alt');
    }

    if (event.shiftKey) {
        held.push('Shift');
    }

    if (!mac && event.metaKey) {
        held.push('Meta');
    }

    return held.map((modifier) => MODIFIER_LABELS[mac ? 'mac' : 'other'][modifier]);
}

function split(chord: KeyChord): { modifiers: Modifier[]; key: string } {
    const parts = chord.endsWith('++') ? [...chord.slice(0, -2).split('+').filter(Boolean), '+'] : chord.split('+');
    const key = parts.pop() ?? '';

    return { modifiers: parts as Modifier[], key };
}

/** Sem `Mod`/`Ctrl`/`Alt`/`Meta` (só `Shift` ou nada), ex.: `F2`, `Delete`, `Escape`. */
export function isSingleKey(chord: KeyChord): boolean {
    return split(chord).modifiers.every((modifier) => modifier === 'Shift');
}

/** Tecla única que produz texto ao digitar (letra, dígito, símbolo, espaço, apagar). */
export function isTypingChord(chord: KeyChord): boolean {
    const { key } = split(chord);

    return isSingleKey(chord) && (key.length === 1 || key === 'Space' || key === 'Backspace' || key === 'Delete' || key === 'Enter' || key === 'Tab');
}

const MODIFIER_LABELS: Readonly<Record<'mac' | 'other', Record<Modifier, string>>> = {
    mac: { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' },
    other: { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Meta' }
};

const MODIFIER_SPOKEN: Readonly<Record<'mac' | 'other', Record<Modifier, string>>> = {
    mac: { Mod: 'Command', Ctrl: 'Control', Alt: 'Option', Shift: 'Shift', Meta: 'Command' },
    other: { Mod: 'Control', Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift', Meta: 'Meta' }
};

const KEY_LABELS: Readonly<Record<string, string>> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
    Delete: 'Del',
    PageUp: 'PgUp',
    PageDown: 'PgDn'
};

/** Texto para exibir: `Ctrl + Shift + T` (Windows/Linux) ou `⌘⇧T` (macOS). */
export function formatChord(chord: KeyChord, mac: boolean): string {
    const { modifiers, key } = split(chord);
    const labels = MODIFIER_LABELS[mac ? 'mac' : 'other'];
    const keyLabel = mac && key === 'Enter' ? '↩' : (KEY_LABELS[key] ?? key);

    return mac ? [...modifiers.map((modifier) => labels[modifier]), keyLabel].join('') : [...modifiers.map((modifier) => labels[modifier]), keyLabel].join(' + ');
}

/** Texto por extenso para leitores de tela (`Command Shift T`). */
export function spokenChord(chord: KeyChord, mac: boolean): string {
    const { modifiers, key } = split(chord);
    const labels = MODIFIER_SPOKEN[mac ? 'mac' : 'other'];

    return [...modifiers.map((modifier) => labels[modifier]), key === '+' ? 'Plus' : key].join(' ');
}

/** Valor do atributo `aria-keyshortcuts` (ex.: `Control+Shift+T`). */
export function ariaKeyShortcut(chord: KeyChord, mac: boolean): string {
    const { modifiers, key } = split(chord);
    const names: Record<Modifier, string> = { Mod: mac ? 'Meta' : 'Control', Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift', Meta: 'Meta' };

    return [...modifiers.map((modifier) => names[modifier]), key === '+' ? 'Plus' : key].join('+');
}

const ACCELERATOR_KEYS: Readonly<Record<string, string>> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Esc',
    '+': 'Plus'
};

/** Acelerador do menu do Electron (`CmdOrCtrl+Shift+T`). */
export function toElectronAccelerator(chord: KeyChord): string {
    const { modifiers, key } = split(chord);
    const names: Record<Modifier, string> = { Mod: 'CmdOrCtrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Super' };

    return [...modifiers.map((modifier) => names[modifier]), ACCELERATOR_KEYS[key] ?? key].join('+');
}
