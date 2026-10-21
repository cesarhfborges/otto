import { normalizeChord, type KeyChord } from '../keyboard/chord';

export type { KeyChord } from '../keyboard/chord';

export const COMMAND_CATEGORIES = ['App', 'Tabs', 'Request', 'Forms', 'Collections'] as const;

export type CommandCategory = (typeof COMMAND_CATEGORIES)[number];

/**
 * Onde o comando vale, em ordem de prioridade quando dois dividem a mesma tecla:
 * - `focus`: depende do elemento focado (formulário, árvore de coleções);
 * - `tab`: depende da aba ativa (requisição);
 * - `global`: o resto.
 * Comandos `tab`/`global` não rodam com um diálogo modal aberto.
 */
export type CommandScope = 'focus' | 'tab' | 'global';

export interface CommandMeta {
    readonly id: string;
    readonly label: string;
    readonly category: CommandCategory;
    readonly scope: CommandScope;
    /** Atalhos padrão (Windows/Linux e, sem `mac`, também macOS). */
    readonly defaults: readonly KeyChord[];
    readonly mac?: readonly KeyChord[];
    /** Aceita atalho sem modificador (ex.: `F2`, `Delete`, `Escape`). */
    readonly singleKey?: boolean;
    /** Repete enquanto a tecla fica pressionada (navegação). */
    readonly repeatable?: boolean;
    /** Atalho reservado do sistema: sempre o padrão, não pode ser alterado nem usado por outro comando. */
    readonly fixed?: boolean;
}

const goTo = <N extends number>(n: N) => ({ id: `tabs.goTo${n}`, label: `Go to tab ${n}`, category: 'Tabs', scope: 'global', defaults: [`Mod+${n}`] }) as const;

const section = <S extends string>(name: S, label: string, n: number) => ({ id: `request.section.${name}`, label: `Show ${label}`, category: 'Request', scope: 'tab', defaults: [`Alt+${n}`], mac: [`Ctrl+${n}`] }) as const;

/** Catálogo de comandos com atalho. A ordem é a de exibição em Preferences. */
export const COMMANDS = [
    { id: 'app.preferences', label: 'Open Preferences', category: 'App', scope: 'global', defaults: ['Mod+,'], fixed: true },
    { id: 'app.shortcuts', label: 'Show keyboard shortcuts', category: 'App', scope: 'global', defaults: ['Mod+Shift+/'], fixed: true },
    { id: 'app.keyboardShortcutsSettings', label: 'Customize keyboard shortcuts', category: 'App', scope: 'global', defaults: [] },
    { id: 'theme.cycle', label: 'Cycle theme (dark / light / auto)', category: 'App', scope: 'global', defaults: [] },
    { id: 'view.toggleSidebar', label: 'Show / hide sidebar', category: 'App', scope: 'global', defaults: ['Mod+B'] },
    { id: 'view.toggleRequestLayout', label: 'Toggle request layout (side by side / stacked)', category: 'App', scope: 'global', defaults: ['Mod+Alt+L'] },

    { id: 'tabs.close', label: 'Close tab', category: 'Tabs', scope: 'global', defaults: ['Mod+W', 'Ctrl+F4'] },
    { id: 'tabs.closeOthers', label: 'Close other tabs', category: 'Tabs', scope: 'global', defaults: [] },
    { id: 'tabs.closeAll', label: 'Close all tabs', category: 'Tabs', scope: 'global', defaults: ['Mod+Shift+W'] },
    { id: 'tabs.reopenClosed', label: 'Reopen closed tab', category: 'Tabs', scope: 'global', defaults: ['Mod+Shift+T'] },
    { id: 'tabs.next', label: 'Next tab', category: 'Tabs', scope: 'global', defaults: ['Ctrl+Tab', 'Mod+PageDown'], repeatable: true },
    { id: 'tabs.previous', label: 'Previous tab', category: 'Tabs', scope: 'global', defaults: ['Ctrl+Shift+Tab', 'Mod+PageUp'], repeatable: true },
    goTo(1),
    goTo(2),
    goTo(3),
    goTo(4),
    goTo(5),
    goTo(6),
    goTo(7),
    goTo(8),
    { id: 'tabs.goToLast', label: 'Go to last tab', category: 'Tabs', scope: 'global', defaults: ['Mod+9'] },
    { id: 'tabs.moveLeft', label: 'Move tab left', category: 'Tabs', scope: 'global', defaults: ['Mod+Shift+PageUp'], repeatable: true },
    { id: 'tabs.moveRight', label: 'Move tab right', category: 'Tabs', scope: 'global', defaults: ['Mod+Shift+PageDown'], repeatable: true },

    { id: 'request.send', label: 'Send request', category: 'Request', scope: 'tab', defaults: ['Mod+Enter'] },
    { id: 'request.cancel', label: 'Cancel running request', category: 'Request', scope: 'tab', defaults: ['Escape'], singleKey: true, fixed: true },
    { id: 'request.save', label: 'Save request', category: 'Request', scope: 'tab', defaults: ['Mod+S'] },
    { id: 'request.saveAll', label: 'Save all requests', category: 'Request', scope: 'global', defaults: ['Mod+Alt+S'] },
    { id: 'request.focusUrl', label: 'Focus the URL', category: 'Request', scope: 'tab', defaults: ['Mod+L'] },
    section('params', 'Params', 1),
    section('body', 'Body', 2),
    section('headers', 'Headers', 3),
    section('auth', 'Auth', 4),
    section('docs', 'Docs', 5),
    section('preRequest', 'Pre-request script', 6),
    section('postResponse', 'Post-response script', 7),
    { id: 'request.formatBody', label: 'Format body (JSON / XML)', category: 'Request', scope: 'tab', defaults: ['Alt+Shift+F'] },
    { id: 'script.format', label: 'Format script', category: 'Request', scope: 'focus', defaults: ['Alt+Shift+F'] },
    { id: 'script.toggleComment', label: 'Toggle line comment in script', category: 'Request', scope: 'focus', defaults: ['Mod+/'] },
    { id: 'script.toggleBlockComment', label: 'Toggle block comment in script', category: 'Request', scope: 'focus', defaults: ['Alt+Shift+A'] },

    { id: 'form.submit', label: 'Submit the focused form', category: 'Forms', scope: 'focus', defaults: ['Mod+Enter'] },

    { id: 'collection.newRequest', label: 'New request', category: 'Collections', scope: 'global', defaults: ['Mod+N'] },
    { id: 'collection.newFolder', label: 'New folder', category: 'Collections', scope: 'global', defaults: ['Mod+Alt+N'] },
    { id: 'collection.new', label: 'New collection', category: 'Collections', scope: 'global', defaults: ['Mod+Shift+N'] },
    { id: 'collection.import', label: 'Import collection', category: 'Collections', scope: 'global', defaults: ['Mod+O'] },
    { id: 'collection.overview', label: 'Open collection overview', category: 'Collections', scope: 'global', defaults: [] },
    { id: 'sidebar.focus', label: 'Focus the collections sidebar', category: 'Collections', scope: 'global', defaults: ['Mod+Shift+E'] },
    { id: 'sidebar.filter', label: 'Filter requests', category: 'Collections', scope: 'global', defaults: ['Mod+Shift+F'] },
    { id: 'sidebar.rename', label: 'Rename selected item', category: 'Collections', scope: 'focus', defaults: ['F2'], singleKey: true },
    { id: 'sidebar.duplicate', label: 'Duplicate selected item', category: 'Collections', scope: 'focus', defaults: ['Mod+D'] },
    { id: 'sidebar.delete', label: 'Delete selected item', category: 'Collections', scope: 'focus', defaults: ['Delete'], mac: ['Mod+Backspace'], singleKey: true },
    { id: 'environment.select', label: 'Choose environment', category: 'Collections', scope: 'global', defaults: ['Mod+E'] },
    { id: 'environment.manage', label: 'Manage environments', category: 'Collections', scope: 'global', defaults: [] },
    { id: 'workspace.manage', label: 'Manage workspaces', category: 'Collections', scope: 'global', defaults: [] }
] as const satisfies readonly CommandMeta[];

export type CommandId = (typeof COMMANDS)[number]['id'];

/** Um comando do catálogo (com `id` conhecido). */
export type Command = CommandMeta & { readonly id: CommandId };

export const COMMAND_IDS: readonly CommandId[] = COMMANDS.map((command) => command.id);

const COMMAND_INDEX: ReadonlyMap<string, Command> = new Map(COMMANDS.map((command) => [command.id, command]));

export const isCommandId = (value: unknown): value is CommandId => typeof value === 'string' && COMMAND_INDEX.has(value);

export const commandMeta = (id: CommandId): Command => COMMAND_INDEX.get(id)!;

/**
 * Diferenças do usuário em relação ao padrão. Lista vazia = comando sem atalho.
 * Comandos ausentes usam os atalhos padrão (que podem mudar entre versões).
 */
export type KeybindingOverrides = Partial<Record<CommandId, KeyChord[]>>;

export const MAX_CHORDS_PER_COMMAND = 4;

/** Teclas da janela e dos campos de texto (edição, zoom, foco, sair): tratadas pelo sistema, fora do catálogo. */
export const RESERVED_SHORTCUTS: ReadonlyArray<{ label: string; keys: readonly KeyChord[] }> = [
    { label: 'Copy / Cut / Paste', keys: ['Mod+C', 'Mod+X', 'Mod+V'] },
    { label: 'Undo / Redo', keys: ['Mod+Z', 'Mod+Shift+Z', 'Mod+Y'] },
    { label: 'Select all', keys: ['Mod+A'] },
    { label: 'Zoom in / out / reset', keys: ['Mod+=', 'Mod+Shift+=', 'Mod+-', 'Mod+0'] },
    { label: 'Reload window', keys: ['Mod+R', 'Mod+Shift+R'] },
    { label: 'Full screen', keys: ['F11', 'Mod+Ctrl+F'] },
    { label: 'Quit', keys: ['Mod+Q'] },
    { label: 'Move focus', keys: ['Tab', 'Shift+Tab'] },
    // Tratado pelo editor de templates focado (`app-otto-input`); fora dele não faz nada.
    { label: 'Show variable suggestions', keys: ['Ctrl+Space'] }
];

/**
 * Atalhos reservados na plataforma, já normalizados: os comandos fixos do app
 * (Preferences, ajuda de atalhos, cancelar envio) seguidos das teclas do sistema.
 */
export function reservedShortcuts(mac: boolean): ReadonlyArray<{ label: string; keys: KeyChord[] }> {
    const fixed = COMMANDS.filter((meta: CommandMeta) => meta.fixed).map((meta) => ({ label: meta.label, keys: defaultChords(meta, mac) }));
    const system = RESERVED_SHORTCUTS.map(({ label, keys }) => ({ label, keys: keys.map((key) => normalizeChord(key, mac)).filter((key): key is KeyChord => !!key) }));

    return [...fixed, ...system];
}

/** Conjunto normalizado das teclas reservadas na plataforma (nenhum comando configurável pode usá-las). */
export function reservedChords(mac: boolean): ReadonlySet<KeyChord> {
    return new Set(reservedShortcuts(mac).flatMap(({ keys }) => keys));
}

/** Atalhos padrão do comando na plataforma, já normalizados. */
export function defaultChords(meta: CommandMeta, mac: boolean): KeyChord[] {
    return ((mac && meta.mac) || meta.defaults).map((chord) => normalizeChord(chord, mac)).filter((chord): chord is KeyChord => !!chord);
}

/** Atalhos efetivos: o override do usuário ou, sem ele (ou num comando fixo), o padrão. */
export function effectiveChords(meta: CommandMeta, overrides: KeybindingOverrides, mac: boolean): KeyChord[] {
    return (!meta.fixed && overrides[meta.id as CommandId]) || defaultChords(meta, mac);
}

export const sameChords = (a: readonly KeyChord[], b: readonly KeyChord[]): boolean => a.length === b.length && a.every((chord, i) => chord === b[i]);

/**
 * Dois comandos com a mesma tecla conflitam quando têm o mesmo escopo ou um deles é
 * global (o de maior prioridade sempre venceria). Escopos específicos diferentes
 * convivem (ex.: `Mod+Enter` envia o formulário em foco ou a requisição).
 */
export const scopesConflict = (a: CommandMeta, b: CommandMeta): boolean => a.scope === b.scope || a.scope === 'global' || b.scope === 'global';
