import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, input, model, untracked } from '@angular/core';
import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from '@codemirror/commands';
import { javascript, javascriptLanguage, scopeCompletionSource } from '@codemirror/lang-javascript';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { Annotation, Compartment, EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers, placeholder as placeholderExtension, tooltips } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { ScriptPhase } from '@/app/core/scripting/script-runner';
import { RequestDraftsState } from '@/app/core/state/request-drafts.state';
import { ResponsesState } from '@/app/core/state/responses.state';
import { TemplateContextService } from '@/app/core/templating/template-context.service';
import { TemplateScope } from '@/app/core/templating/template-scope';
import { templateCompletionData } from '../template-editor/completion-data';
import { templateTheme } from '../template-editor/template-theme';
import { scriptCompletionData, scriptCompletionSources } from './script-completions';

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
    template: '',
    host: {
        class: 'block min-h-64 overflow-hidden rounded-md border border-surface-300 bg-surface-0 focus-within:border-primary dark:border-surface-700 dark:bg-surface-950'
    }
})
export class ScriptEditor {
    readonly value = model('');
    readonly phase = input.required<ScriptPhase>();
    readonly placeholder = input('');
    readonly ariaLabel = input.required<string>();
    readonly ariaDescribedBy = input<string | null>(null);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
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
        inject(DestroyRef).onDestroy(() => this.view?.destroy());

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
            parent: this.host,
            state: EditorState.create({
                doc: this.value() ?? '',
                extensions: [
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
                    // Tab indenta; Esc e depois Tab (ou Ctrl+M) sai do editor pelo teclado.
                    keymap.of([...closeBracketsKeymap, ...completionKeymap, { key: 'Tab', run: acceptCompletion }, { key: 'Mod-/', run: toggleComment }, ...defaultKeymap, ...historyKeymap, indentWithTab]),
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
    }
}
