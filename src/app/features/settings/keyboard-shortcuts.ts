import { afterNextRender, Component, computed, DOCUMENT, inject, Injector, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { isSingleKey, normalizeChord } from '@shared/keyboard/chord';
import { COMMAND_CATEGORIES, COMMANDS, commandMeta, MAX_CHORDS_PER_COMMAND, reservedChords, reservedShortcuts, scopesConflict, type Command, type CommandId, type KeyChord } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectButtonModule } from 'primeng/selectbutton';
import { KeybindingService } from '../../core/keyboard/keybinding.service';
import { ConfirmState } from '../../core/state/confirm.state';
import { KeybindingsState } from '../../core/state/keybindings.state';
import { ShortcutRecorder } from './shortcut-recorder';

type Filter = 'all' | 'modified' | 'unassigned' | 'conflicts';

interface Row {
    meta: Command;
    chords: KeyChord[];
    modified: boolean;
    conflict: boolean;
}

/** Gravação em andamento: comando e posição do atalho substituído (`null` = adicionar). */
interface Editing {
    id: CommandId;
    index: number | null;
}

const fold = (text: string): string => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Preferences → Keyboard Shortcuts: ver, buscar, alterar, remover e restaurar os atalhos. */
@Component({
    selector: 'app-keyboard-shortcuts-settings',
    imports: [FormsModule, ButtonModule, InputTextModule, MessageModule, SelectButtonModule, ShortcutRecorder],
    templateUrl: './keyboard-shortcuts.html',
    host: { class: 'flex flex-col gap-6' }
})
export class KeyboardShortcutsSettings {
    protected readonly keyboard = inject(KeybindingService);
    protected readonly keybindings = inject(KeybindingsState);
    private readonly confirm = inject(ConfirmState);
    private readonly doc = inject(DOCUMENT);
    private readonly injector = inject(Injector);
    private readonly reserved = reservedChords(this.keyboard.mac);

    protected readonly maxChords = MAX_CHORDS_PER_COMMAND;
    protected readonly reservedShortcuts = reservedShortcuts(this.keyboard.mac);

    protected readonly query = signal('');
    /** "Search by keys": filtra pelos comandos que usam esta tecla. */
    protected readonly keyQuery = signal<KeyChord | null>(null);
    protected readonly searchingKeys = signal(false);
    protected readonly filter = signal<Filter>('all');
    protected readonly recording = signal<Editing | null>(null);
    protected readonly recordError = signal<string | null>(null);
    protected readonly conflict = signal<{ editing: Editing; chord: KeyChord; others: readonly Command[] } | null>(null);
    /** Resultado da última ação, anunciado por leitores de tela. */
    protected readonly announcement = signal('');

    private readonly rows = computed<Row[]>(() => {
        const overrides = this.keybindings.overrides();
        const conflicts = this.keyboard.conflicts();
        const bindings = this.keyboard.bindings();

        // Comandos fixos não são configuráveis: aparecem só em "Reserved by the system".
        return COMMANDS.filter((meta: Command) => !meta.fixed).map((meta) => ({ meta, chords: bindings.get(meta.id) ?? [], modified: overrides[meta.id] !== undefined, conflict: conflicts.has(meta.id) }));
    });

    protected readonly counts = computed(() => {
        const rows = this.rows();

        return { modified: rows.filter((row) => row.modified).length, unassigned: rows.filter((row) => !row.chords.length).length, conflicts: rows.filter((row) => row.conflict).length };
    });

    protected readonly filterOptions = computed(() => {
        const { modified, unassigned, conflicts } = this.counts();

        return [
            { label: 'All', value: 'all' },
            { label: `Modified (${modified})`, value: 'modified' },
            { label: `Unassigned (${unassigned})`, value: 'unassigned' },
            { label: `Conflicts (${conflicts})`, value: 'conflicts' }
        ];
    });

    protected readonly groups = computed(() => {
        const text = fold(this.query().trim());
        // "ctrl+w" digitado na busca também procura pela tecla.
        const typedChord = text.includes('+') || /^f\d+$/.test(text) ? normalizeChord(text, this.keyboard.mac) : null;
        const keyQuery = this.keyQuery();
        const filter = this.filter();

        const visible = this.rows().filter(
            (row) =>
                (filter === 'all' || (filter === 'modified' && row.modified) || (filter === 'unassigned' && !row.chords.length) || (filter === 'conflicts' && row.conflict)) &&
                (!keyQuery || row.chords.includes(keyQuery)) &&
                (!text || fold(row.meta.label).includes(text) || fold(row.meta.category).includes(text) || (!!typedChord && row.chords.includes(typedChord)))
        );

        return COMMAND_CATEGORIES.map((category) => ({ category, rows: visible.filter((row) => row.meta.category === category) })).filter((group) => group.rows.length);
    });

    protected startRecording(id: CommandId, index: number | null): void {
        this.conflict.set(null);
        this.recordError.set(null);
        this.recording.set({ id, index });
    }

    protected onCaptured(chord: KeyChord): void {
        const editing = this.recording();

        if (!editing) {
            return;
        }

        const meta = commandMeta(editing.id);
        const current = this.keyboard.bindings().get(editing.id) ?? [];

        if (this.reserved.has(chord)) {
            this.recordError.set(`${this.keyboard.format(chord)} is reserved by the system.`);

            return;
        }

        if (isSingleKey(chord) && !meta.singleKey) {
            this.recordError.set('Combine the key with Ctrl, Alt or ⌘ — single keys are only allowed for list and tree commands.');

            return;
        }

        if (current.includes(chord)) {
            this.finish(editing, `${meta.label} already uses ${this.keyboard.format(chord)}.`);

            return;
        }

        const others = this.keyboard.commandsFor(chord).filter((other) => other.id !== editing.id && scopesConflict(other, meta));

        if (others.length) {
            this.recording.set(null);
            this.conflict.set({ editing, chord, others });
            this.focusAfterRender('shortcut-conflict-replace');

            return;
        }

        void this.commit(editing, chord, []);
    }

    protected onCancelled(): void {
        const editing = this.recording();

        if (editing) {
            this.finish(editing, '');
        }
    }

    protected replaceConflict(): void {
        const conflict = this.conflict();

        if (conflict) {
            void this.commit(conflict.editing, conflict.chord, conflict.others);
        }
    }

    protected cancelConflict(): void {
        const conflict = this.conflict();

        if (conflict) {
            this.finish(conflict.editing, '');
        }
    }

    protected async remove(id: CommandId, chord: KeyChord): Promise<void> {
        // O chip removido some: o foco vai para o "adicionar" da mesma linha.
        this.focusAfterRender(this.addButtonId(id), this.rowHeaderId(id));
        await this.keybindings.apply({ [id]: (this.keyboard.bindings().get(id) ?? []).filter((c) => c !== chord) });
        this.announcement.set(`${this.keyboard.spoken(chord)} removed from ${commandMeta(id).label}.`);
    }

    protected async resetOne(id: CommandId): Promise<void> {
        // O botão "Reset" some quando o comando volta ao padrão.
        this.focusAfterRender(this.addButtonId(id), this.rowHeaderId(id));
        await this.keybindings.reset(id);
        this.announcement.set(`${commandMeta(id).label} restored to its default shortcuts.`);
    }

    protected async resetAll(): Promise<void> {
        const accepted = await this.confirm.ask({ header: 'Reset keyboard shortcuts', message: 'Reset all keyboard shortcuts to their defaults?', acceptLabel: 'Reset All', severity: 'warn', icon: 'pi pi-refresh' });

        if (accepted) {
            await this.keybindings.reset();
            this.announcement.set('All keyboard shortcuts restored to their defaults.');
        }
    }

    protected onKeySearch(chord: KeyChord): void {
        this.keyQuery.set(chord);
        this.searchingKeys.set(false);
        this.focusAfterRender('shortcut-key-search');
    }

    protected stopKeySearch(): void {
        this.searchingKeys.set(false);
        this.focusAfterRender('shortcut-key-search');
    }

    protected clearKeyQuery(): void {
        this.keyQuery.set(null);
        this.focusAfterRender('shortcut-key-search');
    }

    protected isRecording(id: CommandId, index: number | null): boolean {
        const editing = this.recording();

        return editing?.id === id && editing.index === index;
    }

    protected chipId(id: CommandId, index: number): string {
        return `shortcut-${id}-${index}`;
    }

    protected addButtonId(id: CommandId): string {
        return `shortcut-add-${id}`;
    }

    protected rowHeaderId(id: CommandId): string {
        return `shortcut-row-${id}`;
    }

    private async commit(editing: Editing, chord: KeyChord, takeFrom: readonly Command[]): Promise<void> {
        const bindings = this.keyboard.bindings();
        const current = bindings.get(editing.id) ?? [];
        const next = editing.index === null ? [...current, chord] : current.map((c, i) => (i === editing.index ? chord : c));
        const changes: Partial<Record<CommandId, KeyChord[]>> = { [editing.id]: [...new Set(next)] };

        for (const other of takeFrom) {
            changes[other.id] = (bindings.get(other.id) ?? []).filter((c) => c !== chord);
        }

        await this.keybindings.apply(changes);

        const meta = commandMeta(editing.id);
        const moved = takeFrom.length ? ` (removed from ${takeFrom.map((other) => other.label).join(', ')})` : '';

        this.finish(editing, this.keybindings.status() === 'error' ? '' : `${meta.label}: ${this.keyboard.spoken(chord)} assigned${moved}.`);
    }

    /** Encerra a gravação/conflito e devolve o foco à linha do comando. */
    private finish(editing: Editing, message: string): void {
        this.recording.set(null);
        this.conflict.set(null);
        this.recordError.set(null);
        this.announcement.set(message);
        this.focusAfterRender(editing.index === null ? this.addButtonId(editing.id) : this.chipId(editing.id, editing.index), this.addButtonId(editing.id), this.rowHeaderId(editing.id));
    }

    /** Foca o primeiro elemento existente, depois da próxima renderização. */
    private focusAfterRender(...ids: string[]): void {
        afterNextRender(
            () => {
                for (const id of ids) {
                    const element = this.doc.getElementById(id);

                    if (element) {
                        // `p-button` recebe o id no host: o foco vai para o <button> interno.
                        (element.tagName === 'P-BUTTON' ? (element.querySelector('button') ?? element) : element).focus();

                        return;
                    }
                }
            },
            { injector: this.injector }
        );
    }
}
