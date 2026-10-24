import { computed, DestroyRef, DOCUMENT, inject, Injectable, signal } from '@angular/core';
import { ariaKeyShortcut, eventToChord, formatChord, isTypingChord, spokenChord } from '@shared/keyboard/chord';
import { COMMANDS, effectiveChords, scopesConflict, type Command, type CommandId, type CommandScope, type KeyChord } from '@shared/models';
import { KeybindingsState } from '../state/keybindings.state';
import { CommandRegistry, type CommandContext } from './command-registry';
import { IS_MAC } from './platform';

const SCOPE_PRIORITY: Record<CommandScope, number> = { focus: 0, tab: 1, global: 2 };

const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';
const OVERLAY_SELECTOR = '.p-select-overlay, .p-menu-overlay, .p-tieredmenu-overlay, .p-contextmenu, .p-autocomplete-overlay, .p-multiselect-overlay';

/** Monta o contexto (estado do DOM) no momento da tecla. */
function readContext(doc: Document): CommandContext {
    const target = doc.activeElement;
    const inputFocus = !!target && (target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(target.type)) || (target as HTMLElement).isContentEditable);

    return {
        target,
        modalOpen: !!doc.querySelector(MODAL_SELECTOR),
        overlayOpen: !!doc.querySelector(OVERLAY_SELECTOR),
        inputFocus,
        form: target?.closest('form') ?? null
    };
}

/**
 * Intercepta o teclado (um único listener no `document`, em captura) e executa o
 * comando associado à tecla, conforme os atalhos efetivos (padrão + personalização).
 * Nenhum comando habilitado → não faz nada e não bloqueia a tecla.
 */
@Injectable({ providedIn: 'root' })
export class KeybindingService {
    private readonly doc = inject(DOCUMENT);
    private readonly registry = inject(CommandRegistry);
    private readonly keybindings = inject(KeybindingsState);
    private readonly suspensions = signal(0);

    readonly mac = inject(IS_MAC);

    /** Atalhos efetivos de cada comando. */
    readonly bindings = computed(() => {
        const overrides = this.keybindings.overrides();

        return new Map<CommandId, KeyChord[]>(COMMANDS.map((meta) => [meta.id, effectiveChords(meta, overrides, this.mac)]));
    });

    /** Comandos de cada tecla, do escopo mais específico ao global. */
    private readonly byChord = computed(() => {
        const map = new Map<KeyChord, Command[]>();

        for (const meta of COMMANDS) {
            for (const chord of this.bindings().get(meta.id) ?? []) {
                map.set(chord, [...(map.get(chord) ?? []), meta]);
            }
        }

        for (const metas of map.values()) {
            metas.sort((a, b) => SCOPE_PRIORITY[a.scope] - SCOPE_PRIORITY[b.scope]);
        }

        return map;
    });

    /** Comandos cuja tecla também está num comando concorrente (mesmo escopo ou global). */
    readonly conflicts = computed(() => {
        const ids = new Set<CommandId>();

        for (const metas of this.byChord().values()) {
            for (const a of metas) {
                if (metas.some((b) => b !== a && scopesConflict(a, b))) {
                    ids.add(a.id);
                }
            }
        }

        return ids;
    });

    /** Gravando um atalho em Preferences: nenhum comando executa. */
    readonly suspended = computed(() => this.suspensions() > 0);

    constructor() {
        const listener = (event: KeyboardEvent) => this.onKeydown(event);

        this.doc.addEventListener('keydown', listener, true);
        inject(DestroyRef).onDestroy(() => this.doc.removeEventListener('keydown', listener, true));
    }

    suspend(): void {
        this.suspensions.update((count) => count + 1);
    }

    resume(): void {
        this.suspensions.update((count) => Math.max(0, count - 1));
    }

    /** Comandos que usam a tecla (para avisos de conflito). */
    commandsFor(chord: KeyChord): readonly Command[] {
        return this.byChord().get(chord) ?? [];
    }

    /** Primeiro atalho do comando, formatado para exibição (`''` se não houver). */
    text(id: CommandId): string {
        const chord = this.bindings().get(id)?.[0];

        return chord ? formatChord(chord, this.mac) : '';
    }

    /** Valor de `aria-keyshortcuts` com todos os atalhos do comando (`null` se não houver). */
    aria(id: CommandId): string | null {
        const chords = this.bindings().get(id) ?? [];

        return chords.length ? chords.map((chord) => ariaKeyShortcut(chord, this.mac)).join(' ') : null;
    }

    format(chord: KeyChord): string {
        return formatChord(chord, this.mac);
    }

    spoken(chord: KeyChord): string {
        return spokenChord(chord, this.mac);
    }

    /** Comando com handler habilitado agora (para a paleta). */
    isEnabled(id: CommandId): boolean {
        return this.registry.isEnabled(id, readContext(this.doc));
    }

    /** Executa um comando escolhido na paleta, com o contexto atual. */
    run(id: CommandId): boolean {
        return this.registry.execute(id, readContext(this.doc));
    }

    /** Executa um comando vindo do menu nativo/tray, com o mesmo contexto do teclado. */
    runFromMenu(id: CommandId): void {
        this.registry.execute(id, readContext(this.doc), 'menu');
    }

    private onKeydown(event: KeyboardEvent): void {
        if (this.suspended() || event.isComposing || event.defaultPrevented || event.getModifierState?.('AltGraph')) {
            return;
        }

        const chord = eventToChord(event, this.mac);
        const candidates = chord ? this.byChord().get(chord) : undefined;

        if (!chord || !candidates) {
            return;
        }

        const context = readContext(this.doc);

        for (const meta of candidates) {
            // Nada age "por trás" de um diálogo; digitar num campo não dispara atalhos de tecla única.
            if ((meta.scope !== 'focus' && context.modalOpen) || (context.inputFocus && isTypingChord(chord) && meta.scope !== 'focus')) {
                continue;
            }

            if (event.repeat && !meta.repeatable) {
                // Segurar a tecla não repete a ação, mas também não deixa a tecla passar adiante.
                if (this.registry.isEnabled(meta.id, context)) {
                    event.preventDefault();

                    return;
                }

                continue;
            }

            if (this.registry.execute(meta.id, context)) {
                event.preventDefault();
                event.stopPropagation();

                return;
            }
        }
    }
}
