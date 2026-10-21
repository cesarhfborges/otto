import { acceptCompletion, closeCompletion, completionStatus, selectedCompletion, startCompletion } from '@codemirror/autocomplete';
import { ChangeSet, EditorSelection, EditorState, Facet, Prec, RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, hoverTooltip, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { tokenize, type TagInfo, type TagSegment } from '@shared/templating';

/** Como interpretar o conteúdo de uma tag (estado do chip), fornecido pelo componente. */
export const tagInspector = Facet.define<(inner: string) => TagInfo, (inner: string) => TagInfo>({
    combine: (values) => values.at(-1) ?? ((inner) => ({ expr: null, kind: 'command', label: inner, error: null }))
});

const ICONS: Record<TagInfo['kind'], string> = { variable: 'pi-at', secret: 'pi-lock', command: 'pi-bolt', request: 'pi-link' };

/** Tag que contém a posição (`{{|…}}` até `…|}}`). */
export function tagAt(state: EditorState, pos: number): TagSegment | null {
    const line = state.doc.lineAt(pos);

    for (const segment of tokenize(line.text)) {
        if (segment.type === 'tag' && line.from + segment.start <= pos && pos <= line.from + segment.end) {
            return { ...segment, start: line.from + segment.start, end: line.from + segment.end, innerStart: line.from + segment.innerStart };
        }
    }

    return null;
}

const describeTag = (info: TagInfo): string => {
    const what = info.kind === 'request' ? 'Request reference' : info.kind === 'command' ? 'Command' : 'Variable';
    const value = info.variable ? (info.variable.secret ? ', secret value' : `, value ${info.variable.value || '(empty)'}`) : '';

    return info.error ? `${what} ${info.label}: ${info.error}` : `${what} ${info.label}${value}`;
};

class ChipWidget extends WidgetType {
    constructor(
        readonly info: TagInfo,
        readonly start: number
    ) {
        super();
    }

    override eq(other: ChipWidget): boolean {
        return other.info.label === this.info.label && other.info.error === this.info.error && other.info.kind === this.info.kind && other.start === this.start && other.info.variable?.value === this.info.variable?.value;
    }

    toDOM(view: EditorView): HTMLElement {
        const chip = document.createElement('span');
        const icon = document.createElement('i');

        chip.className = 'otto-template-chip';
        chip.dataset['state'] = this.info.error ? 'error' : 'ok';
        chip.setAttribute('role', 'img');
        chip.setAttribute('aria-label', describeTag(this.info));
        icon.className = `pi ${this.info.error ? 'pi-exclamation-triangle' : ICONS[this.info.kind]}`;
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');

        label.className = 'otto-template-chip-label';
        // Tag vazia/ilegível: mostra o motivo em vez de um "…" minúsculo.
        label.textContent = this.info.error && (!this.info.label || this.info.label === '…') ? 'empty tag' : this.info.label;
        chip.append(icon, label);
        // Clique abre o texto bruto para edição (o cursor entra na tag).
        chip.addEventListener('mousedown', (event) => {
            event.preventDefault();
            view.dispatch({ selection: { anchor: this.start + 2 } });
            view.focus();
        });

        return chip;
    }

    override ignoreEvent(): boolean {
        return false;
    }
}

function buildChips(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const inspect = view.state.facet(tagInspector);
    const { head } = view.state.selection.main;
    const focused = view.hasFocus;

    for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
            const line = view.state.doc.lineAt(pos);

            for (const segment of tokenize(line.text)) {
                const start = line.from + segment.start;
                const end = line.from + segment.end;

                // Com o cursor dentro da tag, o texto fica editável (sem chip).
                if (segment.type === 'tag' && !(focused && head > start && head < end)) {
                    builder.add(start, end, Decoration.replace({ widget: new ChipWidget(inspect(segment.inner), start) }));
                }
            }

            pos = line.to + 1;
        }
    }

    return builder.finish();
}

const chips = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = buildChips(view);
        }

        update(update: ViewUpdate): void {
            if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged || update.startState.facet(tagInspector) !== update.state.facet(tagInspector)) {
                this.decorations = buildChips(update.view);
            }
        }
    },
    {
        decorations: (plugin) => plugin.decorations,
        // Cursor pula o chip e Backspace/Delete apagam a tag inteira.
        provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none)
    }
);

/** Tooltip do chip: valor resolvido (secretos mascarados) ou o motivo do erro. */
const chipTooltip = hoverTooltip((view, pos) => {
    const tag = tagAt(view.state, pos);

    if (!tag || (view.hasFocus && view.state.selection.main.head > tag.start && view.state.selection.main.head < tag.end)) {
        return null;
    }

    const info = view.state.facet(tagInspector)(tag.inner);

    return {
        pos: tag.start,
        end: tag.end,
        above: true,
        create: () => {
            const dom = document.createElement('div');
            const title = document.createElement('div');
            const detail = document.createElement('div');

            dom.className = 'otto-template-tooltip';
            title.className = 'otto-template-tooltip-title';
            title.textContent = info.variable ? `${info.variable.name} · ${info.variable.label}` : tag.inner.trim();
            detail.className = info.error ? 'otto-template-tooltip-error' : 'otto-template-tooltip-detail';
            detail.textContent = info.error ?? (info.variable ? (info.variable.secret ? '••••••' : info.variable.value || '(empty)') : 'Evaluated when the request is sent');
            dom.append(title, detail);

            return { dom };
        }
    };
});

/**
 * Digitar `{{` fecha com `}}` e abre as sugestões (`{{ | }}`). Com a lista aberta,
 * `.` sobre um namespace e `(` sobre uma função aceitam o item focado.
 */
const autoCloseTag = EditorView.inputHandler.of((view, from, to, text) => {
    const selected = completionStatus(view.state) === 'active' ? selectedCompletion(view.state) : null;

    if (selected && ((text === '.' && selected.type === 'namespace') || (text === '(' && selected.type === 'function'))) {
        return acceptCompletion(view);
    }

    if (text !== '{' || view.state.sliceDoc(from - 1, from) !== '{' || view.state.sliceDoc(from - 2, from - 1) === '\\') {
        return false;
    }

    view.dispatch({ changes: { from, to, insert: '{  }}' }, selection: { anchor: from + 2 }, userEvent: 'input.type' });
    startCompletion(view);

    return true;
});

const templateKeymap = Prec.highest(
    keymap.of([
        {
            // Ctrl+Space em todas as plataformas (Cmd+Space é do Spotlight).
            key: 'Ctrl-Space',
            // Abre as sugestões direto; fora de uma tag, o item escolhido já insere `{{ … }}`.
            run: (view) => {
                startCompletion(view);

                return true;
            }
        },
        {
            // Esc com a tag vazia remove o `{{  }}` inserido.
            key: 'Escape',
            run: (view) => {
                const tag = tagAt(view.state, view.state.selection.main.head);

                if (!tag || tag.inner.trim()) {
                    return false;
                }

                closeCompletion(view);
                view.dispatch({ changes: { from: tag.start, to: tag.end }, selection: { anchor: tag.start } });

                return true;
            }
        },
        {
            // Encostado no chip: abre o texto bruto da tag para edição (Enter fica para enviar/quebrar linha).
            key: 'F2',
            run: (view: EditorView) => {
                if (completionStatus(view.state) === 'active') {
                    return false;
                }

                const { head } = view.state.selection.main;
                const tag = tagAt(view.state, head);

                if (!tag || (head !== tag.start && head !== tag.end)) {
                    return false;
                }

                view.dispatch({ selection: { anchor: tag.end - 2 } });
                startCompletion(view);

                return true;
            }
        }
    ])
);

/** Campo de uma linha: quebras de linha coladas viram espaço. */
const singleLine = EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || tr.newDoc.lines === 1) {
        return tr;
    }

    const changes: Array<{ from: number; to: number; insert: string }> = [];

    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => changes.push({ from: fromA, to: toA, insert: inserted.toString().replace(/\r?\n/g, ' ') }));
    const set = ChangeSet.of(changes, tr.startState.doc.length);

    return { changes: set, selection: EditorSelection.cursor(set.mapPos(tr.startState.selection.main.head, 1)), userEvent: 'input' };
});

/** Chips, tooltip, `{{` → `}}`, Ctrl+Space/Esc/F2 e (opcional) uma linha só. */
export function templateExtensions(multiline: boolean): Extension[] {
    return [chips, chipTooltip, autoCloseTag, templateKeymap, ...(multiline ? [] : [singleLine])];
}
