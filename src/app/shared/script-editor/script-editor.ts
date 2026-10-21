import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, input, model, signal, untracked, viewChild } from '@angular/core';
import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleBlockComment, toggleComment } from '@codemirror/commands';
import { javascript, javascriptLanguage, scopeCompletionSource } from '@codemirror/lang-javascript';
import { bracketMatching, syntaxTree, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { type Diagnostic, linter, lintGutter } from '@codemirror/lint';
import { Annotation, Compartment, EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers, placeholder as placeholderExtension, tooltips } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { MenuItem } from 'primeng/api';
import { ContextMenu } from 'primeng/contextmenu';
import { checkScript } from '@/app/core/scripting/script-policy';
import { registerCommand, type CommandContext } from '@/app/core/keyboard/command-registry';
import { KeybindingService } from '@/app/core/keyboard/keybinding.service';
import type { ScriptPhase } from '@/app/core/scripting/script-runner';
import { RequestDraftsState } from '@/app/core/state/request-drafts.state';
import { ResponsesState } from '@/app/core/state/responses.state';
import { TemplateContextService } from '@/app/core/templating/template-context.service';
import { TemplateScope } from '@/app/core/templating/template-scope';
import { templateCompletionData } from '../template-editor/completion-data';
import { templateTheme } from '../template-editor/template-theme';
import { scriptCompletionData, scriptCompletionSources } from './script-completions';
import { formatScript } from './script-format';

/** Mudança vinda de fora (`[(value)]`): não volta como `valueChange`. */
const external = Annotation.define<boolean>();

/** Globais padrão do JavaScript sugeridos no autocomplete (também existem na execução). */
const GLOBAL_NAMES = [
    'Array', 'Boolean', 'Date', 'Error', 'JSON', 'Map', 'Math', 'Number', 'Object', 'Promise', 'RegExp', 'Set', 'String', 'Symbol',
    'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'crypto', 'atob', 'btoa', 'encodeURIComponent', 'decodeURIComponent',
    'encodeURI', 'decodeURI', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'structuredClone', 'setTimeout', 'clearTimeout'
];
const ICONS: Record<string, string> = {
    namespace: 'pi-angle-right',
    function: 'pi-bolt',
    method: 'pi-bolt',
    property: 'pi-circle-fill',
    variable: 'pi-at',
    class: 'pi-box',
    constant: 'pi-lock',
    keyword: 'pi-code',
    text: 'pi-file-edit'
};

const globals = Object.fromEntries(GLOBAL_NAMES.filter((name) => name in globalThis).map((name) => [name, (globalThis as Record<string, unknown>)[name]]));

/**
 * Editores montados, pelo elemento host. Os atalhos (`script.*`) são comandos globais com um
 * único handler ativo: ele age no editor que tem o foco, qualquer que seja.
 */
const editors = new Map<Element, EditorView>();

const focusedEditor = ({ target }: CommandContext) => {
    const host = target?.closest('app-script-editor');

    return host ? (editors.get(host) ?? null) : null;
};

const editorCommand = (run: (view: EditorView) => unknown) => ({
    when: (context: CommandContext) => !!focusedEditor(context),
    run: (context: CommandContext) => {
        const view = focusedEditor(context);

        return view && run(view);
    }
});

/** Substitui o documento pelo script formatado; com erro de sintaxe (já marcado no lint) não muda nada. */
async function format(view: EditorView): Promise<void> {
    const code = view.state.doc.toString();
    const formatted = await formatScript(code).catch(() => null);

    if (formatted === null || formatted === code || view.state.doc.toString() !== code) {
        return;
    }

    view.dispatch({ changes: { from: 0, to: code.length, insert: formatted }, selection: { anchor: Math.min(view.state.selection.main.head, formatted.length) }, scrollIntoView: true });
}

/** Comandos bloqueados (os mesmos que impedem a execução) e erros de sintaxe. */
const scriptLinter = linter(
    (view) => {
        const code = view.state.doc.toString();
        const diagnostics: Diagnostic[] = checkScript(code).map((violation) => ({ ...violation, severity: 'error', source: 'otto' }));

        syntaxTree(view.state).iterate({
            enter: (node) => {
                if (node.type.isError) {
                    const from = Math.min(node.from, code.length);

                    diagnostics.push({ from, to: Math.min(Math.max(node.to, from + 1), code.length), severity: 'error', message: 'Syntax error' });
                }
            }
        });

        return diagnostics;
    },
    { delay: 300 }
);

/** Cores da paleta de realce (Settings → Appearance), as mesmas do highlight.js. */
const highlightStyle = HighlightStyle.define([
    { tag: [tags.keyword, tags.bool, tags.null, tags.self, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword], color: 'var(--otto-hl-literal)' },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--otto-hl-string)' },
    { tag: tags.number, color: 'var(--otto-hl-number)' },
    { tag: [tags.propertyName, tags.attributeName], color: 'var(--otto-hl-key)' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.className], color: 'var(--otto-hl-tag)' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--otto-hl-comment)', fontStyle: 'italic' }
]);

const scriptTheme = EditorView.theme({
    '&': { height: '100%' },
    '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace', scrollbarWidth: 'auto', overflow: 'auto' },
    '.cm-content': { padding: '0.75rem 0' },
    '.cm-line': { fontSize: 'var(--otto-code-font-size, 14px)', padding: '0 0.75rem 0 0' },
    '.cm-gutters': { marginRight: '0.5rem', paddingLeft: '0.5rem' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--p-primary-color) 6%, transparent)' },
    '&.cm-focused .cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--p-primary-color) 22%, transparent)', outline: 'none' }
});

/**
 * Editor de JavaScript (CodeMirror 6) dos scripts da requisição: realce, indentação,
 * fechamento de colchetes e autocomplete dos comandos `otto` (o catálogo dos templates,
 * filtrado pela fase, com JSONPaths/headers da última resposta e variáveis), dos globais
 * do JavaScript e das variáveis declaradas no script.
 */
@Component({
    selector: 'app-script-editor',
    imports: [ContextMenu],
    template: `
        <div #mount class="h-full"></div>
        <p-contextmenu #menu [model]="menuItems()" appendTo="body" (onHide)="focus()" />
    `,
    host: {
        class: 'block min-h-64 overflow-hidden rounded-md border border-surface-300 bg-surface-0 focus-within:border-primary dark:border-surface-700 dark:bg-surface-950',
        '(contextmenu)': 'openMenu($event)'
    }
})
export class ScriptEditor {
    readonly value = model('');
    readonly phase = input.required<ScriptPhase>();
    readonly placeholder = input('');
    readonly ariaLabel = input.required<string>();
    readonly ariaDescribedBy = input<string | null>(null);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    private readonly keyboard = inject(KeybindingService);
    private readonly mountPoint = viewChild.required<ElementRef<HTMLElement>>('mount');
    private readonly menu = viewChild.required<ContextMenu>('menu');
    /** Estado lido ao abrir o menu: seleção e área de transferência. */
    private readonly menuState = signal({ selection: false, clipboard: false });
    protected readonly menuItems = computed<MenuItem[]>(() => {
        const { selection, clipboard } = this.menuState();

        return [
            { label: 'Select All', icon: 'pi pi-list', command: () => this.run((view) => view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })) },
            { label: 'Copy', icon: 'pi pi-copy', disabled: !selection, command: () => this.run((view) => this.copy(view)) },
            { label: 'Paste', icon: 'pi pi-clipboard', disabled: !clipboard, command: () => this.run((view) => this.paste(view)) },
            { separator: true },
            { label: 'Format', icon: 'pi pi-align-left', shortcut: this.keyboard.text('script.format'), command: () => this.format() }
        ];
    });
    private readonly scope = inject(TemplateScope, { optional: true });
    private readonly templates = inject(TemplateContextService);
    private readonly responses = inject(ResponsesState);
    private readonly drafts = inject(RequestDraftsState);
    /** Mesmos dados do autocomplete dos templates: variáveis, requisições, última resposta. */
    private readonly completion = computed(() => {
        const collectionId = this.scope?.collectionId() ?? null;

        return templateCompletionData(
            { templates: this.templates, responses: this.responses, drafts: this.drafts },
            collectionId,
            this.templates.validationEnv(collectionId, this.scope?.localVariables() ?? null).scopes,
            this.scope?.requestPath() ?? null
        );
    });
    private readonly data = new Compartment();
    private readonly attributes = new Compartment();
    private view: EditorView | null = null;

    constructor() {
        afterNextRender(() => this.mount());
        inject(DestroyRef).onDestroy(() => {
            editors.delete(this.host);
            this.view?.destroy();
        });
        registerCommand('script.format', editorCommand(format));
        registerCommand('script.toggleComment', editorCommand(toggleComment));
        registerCommand('script.toggleBlockComment', editorCommand(toggleBlockComment));

        effect(() => {
            const value = this.value() ?? '';

            if (this.view && value !== this.view.state.doc.toString()) {
                this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: value }, annotations: external.of(true) });
            }
        });
        effect(() => {
            const extension = this.dataExtension();

            untracked(() => this.view?.dispatch({ effects: this.data.reconfigure(extension) }));
        });
        effect(() => {
            const extension = this.attributesExtension();

            untracked(() => this.view?.dispatch({ effects: this.attributes.reconfigure(extension) }));
        });
    }

    focus(): void {
        this.view?.focus();
    }

    /** Formata com o Prettier (botão da aba, menu e `script.format`). */
    format(): Promise<void> {
        return this.view ? format(this.view) : Promise.resolve();
    }

    protected async openMenu(event: MouseEvent): Promise<void> {
        const view = this.view;

        if (!view) {
            return;
        }

        event.preventDefault();
        const clipboard = await navigator.clipboard.readText().then(
            (text) => text.length > 0,
            () => false
        );

        this.menuState.set({ selection: !view.state.selection.main.empty, clipboard });
        this.menu().show(event);
    }

    private run(action: (view: EditorView) => unknown): void {
        if (this.view) {
            action(this.view);
            this.view.focus();
        }
    }

    private copy(view: EditorView): Promise<void> {
        const { from, to } = view.state.selection.main;

        return navigator.clipboard.writeText(view.state.sliceDoc(from, to));
    }

    private async paste(view: EditorView): Promise<void> {
        const text = await navigator.clipboard.readText();

        view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input.paste' });
    }

    private dataExtension() {
        return scriptCompletionData.of({ phase: this.phase(), data: this.completion() });
    }

    private attributesExtension() {
        const describedBy = this.ariaDescribedBy();

        return [
            EditorView.contentAttributes.of({ 'aria-label': this.ariaLabel(), 'aria-multiline': 'true', ...(describedBy && { 'aria-describedby': describedBy }) }),
            placeholderExtension(this.placeholder())
        ];
    }

    private mount(): void {
        this.view = new EditorView({
            parent: this.mountPoint().nativeElement,
            state: EditorState.create({
                doc: this.value() ?? '',
                extensions: [
                    lintGutter(),
                    lineNumbers(),
                    history(),
                    highlightActiveLine(),
                    bracketMatching(),
                    closeBrackets(),
                    indentOnInput(),
                    javascript(),
                    javascriptLanguage.data.of({ autocomplete: scopeCompletionSource(globals) }),
                    ...scriptCompletionSources.map((source) => javascriptLanguage.data.of({ autocomplete: source })),
                    tooltips({ parent: document.body }),
                    autocompletion({
                        icons: false,
                        maxRenderedOptions: 150,
                        addToOptions: [
                            {
                                position: 20,
                                render: (completion) => {
                                    const icon = document.createElement('i');

                                    icon.className = `otto-completion-icon pi ${ICONS[completion.type ?? ''] ?? 'pi-minus'}`;
                                    icon.setAttribute('aria-hidden', 'true');

                                    return icon;
                                }
                            }
                        ]
                    }),
                    syntaxHighlighting(highlightStyle),
                    scriptLinter,
                    // Tab indenta; Esc e depois Tab (ou Ctrl+M) sai do editor pelo teclado.
                    keymap.of([...closeBracketsKeymap, ...completionKeymap, { key: 'Tab', run: acceptCompletion }, ...defaultKeymap, ...historyKeymap, indentWithTab]),
                    EditorState.tabSize.of(4),
                    templateTheme,
                    scriptTheme,
                    this.data.of(this.dataExtension()),
                    this.attributes.of(this.attributesExtension()),
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged && !update.transactions.some((tr) => tr.annotation(external))) {
                            this.value.set(update.state.doc.toString());
                        }
                    })
                ]
            })
        });
        editors.set(this.host, this.view);
    }
}
