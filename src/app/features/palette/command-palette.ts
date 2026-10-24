import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { COMMANDS, type CollectionNode, type CommandId, type HttpMethod } from '@shared/models';
import { DialogModule } from 'primeng/dialog';
import { KeybindingService } from '../../core/keyboard/keybinding.service';
import { CollectionsState } from '../../core/state/collections.state';
import { EnvironmentsState } from '../../core/state/environments.state';
import { TabsState } from '../../core/state/tabs.state';
import { UiState } from '../../core/state/ui.state';
import { MethodBadge } from '../../shared/method-badge';

type Group = 'Requests' | 'Folders' | 'Commands' | 'Environments';

interface PaletteItem {
    id: string;
    group: Group;
    label: string;
    detail: string;
    icon: string;
    method: HttpMethod | null;
    keys: string;
    run: () => void;
}

/** Máximo de itens por grupo (a busca refina o resto). */
const MAX_PER_GROUP = 40;

/** Comandos que dependem do foco ou que não fazem sentido a partir da paleta. */
const HIDDEN_COMMANDS = new Set<string>(['app.commandPalette', 'form.submit', 'request.cancel']);

const fold = (text: string): string => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Todas as palavras precisam aparecer; começar pelo nome pesa mais. `null` = não combina. */
function score(item: PaletteItem, words: string[]): number | null {
    const label = fold(item.label);
    const haystack = `${label} ${fold(item.detail)}`;
    let total = 0;

    for (const word of words) {
        const index = haystack.indexOf(word);

        if (index < 0) {
            return null;
        }

        total += label.startsWith(word) ? 0 : index < label.length ? 1 : 2;
    }

    return total;
}

interface FlatNode {
    node: CollectionNode;
    trail: string;
}

const flatten = (nodes: readonly CollectionNode[], trail: string): FlatNode[] => nodes.flatMap((node) => [{ node, trail }, ...(node.type === 'folder' ? flatten(node.children, `${trail} / ${node.name}`) : [])]);

/**
 * Paleta de comandos (`Mod+K` / `Mod+P`): busca requisições e pastas das coleções abertas,
 * comandos habilitados e os ambientes da coleção atual. `>` filtra só comandos, `@` só ambientes, `/` só pastas.
 */
@Component({
    selector: 'app-command-palette',
    imports: [DialogModule, MethodBadge],
    template: `
        @if (ui.commandPalette()) {
            <p-dialog
                closeAriaLabel="Close"
                header="Command Palette"
                position="top"
                appendTo="body"
                [modal]="true"
                [visible]="true"
                [dismissableMask]="true"
                [showHeader]="false"
                (visibleChange)="!$event && close()"
                [style]="{ width: '40rem', marginTop: '4rem' }"
                [draggable]="false"
                contentStyleClass="!p-0"
                [pt]="{ root: { 'aria-label': 'Command palette' } }"
            >
                <div class="flex flex-col">
                    <label id="palette-label" for="palette-input" class="sr-only">Search requests, commands and environments</label>
                    <div class="flex items-center gap-2 border-b border-surface-200 px-3 dark:border-surface-700">
                        <i class="pi pi-search text-muted-color" aria-hidden="true"></i>
                        <input
                            #input
                            id="palette-input"
                            type="text"
                            role="combobox"
                            aria-autocomplete="list"
                            aria-expanded="true"
                            aria-controls="palette-list"
                            aria-describedby="palette-hint"
                            [attr.aria-activedescendant]="activeItem() ? 'palette-option-' + activeIndex() : null"
                            class="min-w-0 flex-1 border-0 bg-transparent py-3 text-sm text-color outline-none placeholder:text-muted-color"
                            placeholder="Search requests, commands and environments…"
                            autocomplete="off"
                            spellcheck="false"
                            [value]="query()"
                            (input)="setQuery($any($event.target).value)"
                            (keydown)="onKeydown($event)"
                        />
                    </div>
                    <p id="palette-hint" class="sr-only">Type &gt; for commands only, @ for environments, / for folders. Use the arrow keys to move and Enter to run.</p>
                    <div id="palette-list" role="listbox" aria-label="Results" class="max-h-[55vh] overflow-auto py-1" #list>
                        @for (group of groups(); track group.name) {
                            <div role="group" [attr.aria-labelledby]="'palette-group-' + group.name">
                                <div [id]="'palette-group-' + group.name" role="presentation" class="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-color">{{ group.name }}</div>
                                @for (entry of group.items; track entry.item.id) {
                                    <div
                                        [id]="'palette-option-' + entry.index"
                                        role="option"
                                        [attr.aria-selected]="entry.index === activeIndex()"
                                        class="mx-1 flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm"
                                        [class.bg-emphasis]="entry.index === activeIndex()"
                                        (mousemove)="activeIndex.set(entry.index)"
                                        (click)="choose(entry.item)"
                                    >
                                        @if (entry.item.method) {
                                            <app-method-badge class="w-12 shrink-0" [method]="entry.item.method" [compact]="true" />
                                        } @else {
                                            <i [class]="entry.item.icon + ' w-12 shrink-0 text-center text-muted-color'" aria-hidden="true"></i>
                                        }
                                        <span class="min-w-0 flex-1">
                                            <span class="block truncate">{{ entry.item.label }}</span>
                                            @if (entry.item.detail) {
                                                <span class="block truncate text-xs text-surface-600 dark:text-surface-400">{{ entry.item.detail }}</span>
                                            }
                                        </span>
                                        @if (entry.item.keys) {
                                            <kbd class="shrink-0 rounded border border-surface-300 bg-surface-50 px-1.5 font-sans text-xs dark:border-surface-600 dark:bg-surface-800">{{ entry.item.keys }}</kbd>
                                        }
                                    </div>
                                }
                            </div>
                        } @empty {
                            <p class="m-0 px-3 py-4 text-center text-sm text-muted-color" role="status">Nothing matches “{{ query() }}”.</p>
                        }
                    </div>
                    <div class="flex flex-wrap gap-x-4 gap-y-1 border-t border-surface-200 px-3 py-2 text-xs text-muted-color dark:border-surface-700" aria-hidden="true">
                        <span><kbd class="font-sans">↑↓</kbd> move</span>
                        <span><kbd class="font-sans">Enter</kbd> open / run</span>
                        <span><kbd class="font-sans">&gt;</kbd> commands</span>
                        <span><kbd class="font-sans">&#64;</kbd> environments</span>
                        <span><kbd class="font-sans">/</kbd> folders</span>
                        <span class="ms-auto"><kbd class="font-sans">Esc</kbd> close</span>
                    </div>
                </div>
            </p-dialog>
        }
    `
})
export class CommandPalette {
    protected readonly ui = inject(UiState);
    private readonly keyboard = inject(KeybindingService);
    private readonly collections = inject(CollectionsState);
    private readonly environments = inject(EnvironmentsState);
    private readonly tabs = inject(TabsState);

    private readonly input = viewChild<ElementRef<HTMLInputElement>>('input');
    private readonly list = viewChild<ElementRef<HTMLElement>>('list');

    protected readonly query = signal('');
    protected readonly activeIndex = signal(0);
    /** Comandos habilitados no momento em que a paleta abriu (antes do diálogo, que muda o contexto). */
    private readonly enabledCommands = signal<ReadonlySet<CommandId>>(new Set());

    private readonly requestItems = computed<PaletteItem[]>(() =>
        this.collections.opened().flatMap((collection) =>
            flatten(collection.tree.children, collection.manifest.name).flatMap(({ node, trail }): PaletteItem[] => {
                const collectionId = collection.metadata.id;

                if (node.type === 'folder') {
                    return [{ id: `folder:${collectionId}:${node.path}`, group: 'Folders', label: node.name, detail: `${trail} · Folder settings`, icon: 'pi pi-folder', method: null, keys: '', run: () => this.tabs.open({ kind: 'folder', title: node.name, collectionId, resourceRef: node.path }) }];
                }

                return node.method ? [{ id: `request:${collectionId}:${node.path}`, group: 'Requests', label: node.name, detail: trail, icon: 'pi pi-file', method: node.method, keys: '', run: () => this.tabs.open({ kind: 'request', title: node.name, collectionId, resourceRef: node.path }) }] : [];
            })
        )
    );

    private readonly commandItems = computed<PaletteItem[]>(() => {
        const enabled = this.enabledCommands();

        return COMMANDS.filter((command) => command.scope !== 'focus' && !HIDDEN_COMMANDS.has(command.id) && enabled.has(command.id)).map((command) => ({
            id: `command:${command.id}`,
            group: 'Commands',
            label: command.label,
            detail: command.category,
            icon: 'pi pi-bolt',
            method: null,
            keys: this.keyboard.text(command.id),
            run: () => this.keyboard.run(command.id)
        }));
    });

    private readonly environmentItems = computed<PaletteItem[]>(() => {
        const collectionId = this.tabs.context();

        if (!collectionId) {
            return [];
        }

        const name = this.collections.find(collectionId)?.manifest.name ?? '';
        const active = this.environments.activeFor(collectionId);
        const select = (id: string | null) => () => this.environments.select(collectionId, id);

        return [
            { id: 'env:none', group: 'Environments', label: 'No environment', detail: `${name}${active === null ? ' · active' : ''}`, icon: 'pi pi-ban', method: null, keys: '', run: select(null) },
            ...this.environments.list(collectionId).map((environment) => ({
                id: `env:${environment.id}`,
                group: 'Environments' as const,
                label: environment.name,
                detail: `${name} · ${environment.variables.length} variable${environment.variables.length === 1 ? '' : 's'}${environment.id === active ? ' · active' : ''}`,
                icon: environment.id === active ? 'pi pi-check-circle' : 'pi pi-globe',
                method: null,
                keys: '',
                run: select(environment.id)
            }))
        ];
    });

    /** Prefixo escolhe o grupo; sem texto, mostra comandos e requisições recentes da coleção atual primeiro. */
    protected readonly groups = computed(() => {
        const raw = this.query().trimStart();
        const prefix = raw[0];
        const scoped: Group | null = prefix === '>' ? 'Commands' : prefix === '@' ? 'Environments' : prefix === '/' ? 'Folders' : null;
        const words = fold(scoped ? raw.slice(1) : raw)
            .split(/\s+/)
            .filter(Boolean);
        const order: Group[] = scoped ? [scoped] : words.length ? ['Requests', 'Commands', 'Environments', 'Folders'] : ['Requests', 'Commands', 'Environments'];
        const source: Record<Group, PaletteItem[]> = { Requests: this.requestItems(), Folders: this.requestItems(), Commands: this.commandItems(), Environments: this.environmentItems() };
        let index = 0;

        return order
            .map((name) => {
                const candidates = source[name].filter((item) => item.group === name);
                const ranked = words.length
                    ? candidates
                          .map((item) => ({ item, score: score(item, words) }))
                          .filter((entry): entry is { item: PaletteItem; score: number } => entry.score !== null)
                          .sort((a, b) => a.score - b.score)
                          .map((entry) => entry.item)
                    : candidates;

                return { name, items: ranked.slice(0, MAX_PER_GROUP) };
            })
            .filter((group) => group.items.length)
            .map((group) => ({ name: group.name, items: group.items.map((item) => ({ item, index: index++ })) }));
    });

    private readonly flat = computed(() => this.groups().flatMap((group) => group.items.map((entry) => entry.item)));
    protected readonly activeItem = computed(() => this.flat()[this.activeIndex()] ?? null);

    constructor() {
        effect(() => {
            if (!this.ui.commandPalette()) {
                return;
            }

            untracked(() => {
                this.enabledCommands.set(new Set(COMMANDS.map((command) => command.id).filter((id) => this.keyboard.isEnabled(id))));
                this.query.set('');
                this.activeIndex.set(0);

                const collectionId = this.tabs.context();

                if (collectionId) {
                    void this.environments.load(collectionId);
                }

                setTimeout(() => this.input()?.nativeElement.focus());
            });
        });
    }

    protected setQuery(value: string): void {
        this.query.set(value);
        this.activeIndex.set(0);
    }

    protected onKeydown(event: KeyboardEvent): void {
        const count = this.flat().length;

        switch (event.key) {
            case 'ArrowDown':
            case 'ArrowUp': {
                event.preventDefault();

                if (count) {
                    this.activeIndex.update((i) => (i + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
                    this.scrollToActive();
                }

                break;
            }
            case 'PageDown':
            case 'PageUp':
                event.preventDefault();
                this.activeIndex.update((i) => Math.max(0, Math.min(count - 1, i + (event.key === 'PageDown' ? 8 : -8))));
                this.scrollToActive();
                break;
            case 'Enter': {
                event.preventDefault();
                const item = this.activeItem();

                if (item) {
                    this.choose(item);
                }

                break;
            }
        }
    }

    protected choose(item: PaletteItem): void {
        this.close();
        // Executa depois que o diálogo sai do DOM (os comandos veem o contexto sem o modal).
        setTimeout(() => item.run());
    }

    protected close(): void {
        this.ui.commandPalette.set(false);
    }

    private scrollToActive(): void {
        setTimeout(() => this.list()?.nativeElement.querySelector(`#palette-option-${this.activeIndex()}`)?.scrollIntoView({ block: 'nearest' }));
    }
}
