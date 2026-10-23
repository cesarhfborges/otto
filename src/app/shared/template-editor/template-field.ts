import { acceptCompletion, autocompletion, completionStatus } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { Annotation, Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExtension, tooltips } from '@codemirror/view';
import { afterNextRender, booleanAttribute, computed, DestroyRef, Directive, effect, ElementRef, inject, input, model, output, signal, untracked } from '@angular/core';
import type { ControlValueAccessor } from '@angular/forms';
import { RequestDraftsState } from '@/app/core/state/request-drafts.state';
import { ResponsesState } from '@/app/core/state/responses.state';
import { TemplateContextService } from '@/app/core/templating/template-context.service';
import { TemplateScope } from '@/app/core/templating/template-scope';
import { inspectTag, tokenize } from '@shared/templating';
import { completionData, templateCompletions, type TemplateCompletionData } from './template-completions';
import { templateCompletionData } from './completion-data';
import { tagInspector, templateExtensions } from './template-extensions';
import { templateTheme } from './template-theme';

/** Mudança vinda de fora (`writeValue`, `[(value)]`): não volta como `onChange`. */
const external = Annotation.define<boolean>();

const ICONS: Record<string, string> = { variable: 'pi-at', secret: 'pi-lock', function: 'pi-bolt', namespace: 'pi-angle-right', property: 'pi-circle-fill', request: 'pi-link', value: 'pi-minus' };

/**
 * Base de `app-otto-input` e `app-otto-textarea`: CodeMirror 6 com chips de
 * variáveis/comandos, autocomplete, `ControlValueAccessor` (ngModel/formControl) e
 * `[(value)]` com signals. As subclasses só dizem se o campo tem várias linhas.
 */
@Directive({
    host: {
        class: 'otto-template-field',
        '[class.otto-mono]': 'monospace()',
        '[class.otto-multiline]': 'multiline',
        '[class.p-invalid]': 'invalid() || hasErrors()',
        '[class.p-disabled]': 'isDisabled()',
        '(mousedown)': 'focusFromPadding($event)'
    }
})
export abstract class TemplateField implements ControlValueAccessor {
    /** Texto bruto (com `{{…}}`). */
    readonly value = model('');
    readonly placeholder = input('');
    readonly disabled = input(false, { transform: booleanAttribute });
    readonly readonly = input(false, { transform: booleanAttribute });
    /** Estado de erro (como `p-invalid`); chips incorretos também marcam o campo. */
    readonly invalid = input(false, { transform: booleanAttribute });
    /** URL/headers usam fonte mono; descrições não. */
    readonly monospace = input(true, { transform: booleanAttribute });
    readonly inputId = input<string | null>(null);
    readonly ariaLabel = input<string | null>(null);
    readonly ariaLabelledBy = input<string | null>(null);
    readonly ariaDescribedBy = input<string | null>(null);
    readonly focused = output<FocusEvent>({ alias: 'focus' });
    readonly blurred = output<FocusEvent>({ alias: 'blur' });

    protected abstract readonly multiline: boolean;
    /** Atributos extras do elemento editável (ex.: `aria-multiline`). */
    protected extraContentAttributes(): Record<string, string> {
        return {};
    }
    /** Extensões extras (reconfiguradas quando os signals lidos mudam), ex.: números de linha. */
    protected extraExtensions(): Extension[] {
        return [];
    }

    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    private readonly scope = inject(TemplateScope, { optional: true });
    private readonly templates = inject(TemplateContextService);
    private readonly responses = inject(ResponsesState);
    private readonly drafts = inject(RequestDraftsState);
    private readonly formDisabled = signal(false);
    private readonly config = new Compartment();
    private readonly data = new Compartment();
    private view: EditorView | null = null;
    /** Editor montado (após o primeiro render), para as subclasses despacharem efeitos. */
    protected readonly editorView = signal<EditorView | null>(null);
    private onChange: (value: string) => void = () => undefined;
    private onTouched: () => void = () => undefined;

    protected readonly isDisabled = computed(() => this.disabled() || this.formDisabled());
    private readonly collectionId = computed(() => this.scope?.collectionId() ?? null);
    private readonly validation = computed(() => this.templates.validationEnv(this.collectionId(), this.scope?.localVariables() ?? null));
    private readonly inspector = computed(() => {
        const env = this.validation();

        return (inner: string) => inspectTag(inner, env);
    });
    protected readonly hasErrors = computed(() => {
        const inspect = this.inspector();

        return tokenize(this.value()).some((segment) => segment.type === 'tag' && inspect(segment.inner).error !== null);
    });

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
            const extensions = this.configExtensions();

            untracked(() => this.view?.dispatch({ effects: this.config.reconfigure(extensions) }));
        });
        effect(() => {
            const extensions = [tagInspector.of(this.inspector()), completionData.of(this.completionSource())];

            untracked(() => this.view?.dispatch({ effects: this.data.reconfigure(extensions) }));
        });
    }

    focus(): void {
        this.view?.focus();
    }

    select(): void {
        this.view?.dispatch({ selection: { anchor: 0, head: this.view.state.doc.length } });
        this.view?.focus();
    }

    writeValue(value: string | null): void {
        this.value.set(value ?? '');
    }

    registerOnChange(fn: (value: string) => void): void {
        this.onChange = fn;
    }

    registerOnTouched(fn: () => void): void {
        this.onTouched = fn;
    }

    setDisabledState(disabled: boolean): void {
        this.formDisabled.set(disabled);
    }

    /** Clique no padding do campo (fora do texto) também foca o editor. */
    protected focusFromPadding(event: MouseEvent): void {
        if (event.target === this.host && this.view && !this.isDisabled()) {
            event.preventDefault();
            this.view.focus();
            this.view.dispatch({ selection: { anchor: this.view.state.doc.length } });
        }
    }

    private configExtensions() {
        const disabled = this.isDisabled();
        const invalid = this.invalid() || this.hasErrors();
        const attributes: Record<string, string> = {
            spellcheck: 'false',
            autocorrect: 'off',
            autocapitalize: 'off',
            'aria-invalid': String(invalid),
            ...this.extraContentAttributes()
        };

        for (const [name, value] of [
            ['id', this.inputId()],
            ['aria-label', this.ariaLabel()],
            ['aria-labelledby', this.ariaLabelledBy()],
            ['aria-describedby', this.ariaDescribedBy()]
        ] as const) {
            if (value) {
                attributes[name] = value;
            }
        }

        if (disabled) {
            attributes['aria-disabled'] = 'true';
        }

        if (this.readonly()) {
            attributes['aria-readonly'] = 'true';
        }

        return [EditorView.contentAttributes.of(attributes), EditorView.editable.of(!disabled), EditorState.readOnly.of(disabled || this.readonly()), ...(this.placeholder() ? [placeholderExtension(this.placeholder())] : []), ...this.extraExtensions()];
    }

    private completionSource(): TemplateCompletionData {
        return templateCompletionData({ templates: this.templates, responses: this.responses, drafts: this.drafts }, this.collectionId(), this.validation().scopes, this.scope?.requestPath() ?? null);
    }

    private mount(): void {
        const singleLineEnter = EditorView.domEventHandlers({
            keydown: (event, view) => {
                if (event.key !== 'Enter' || event.isComposing) {
                    return false;
                }

                // Com a lista aberta, Enter aceita a sugestão e não chega ao formulário.
                if (completionStatus(view.state) === 'active') {
                    event.stopPropagation();

                    return false;
                }

                const handled = this.onEnter(event);

                if (handled) {
                    event.preventDefault();
                }

                return handled;
            }
        });

        this.view = new EditorView({
            parent: this.host,
            state: EditorState.create({
                doc: this.value() ?? '',
                extensions: [
                    history(),
                    templateTheme,
                    tooltips({ parent: document.body }),
                    autocompletion({
                        override: [templateCompletions],
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
                    Prec.high(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
                    // Uma linha: Enter (e variações) nunca inserem quebra; com a lista aberta o
                    // keymap do autocomplete (precedência maior) aceita a sugestão antes daqui.
                    ...(this.multiline ? [] : [Prec.high(keymap.of(['Enter', 'Shift-Enter', 'Mod-Enter', 'Alt-Enter'].map((key) => ({ key, run: () => true }))))]),
                    keymap.of([...defaultKeymap, ...historyKeymap]),
                    singleLineEnter,
                    ...templateExtensions(this.multiline),
                    ...(this.multiline ? [EditorView.lineWrapping] : []),
                    this.config.of(this.configExtensions()),
                    this.data.of([tagInspector.of(this.inspector()), completionData.of(this.completionSource())]),
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged && !update.transactions.some((tr) => tr.annotation(external))) {
                            const text = update.state.doc.toString();

                            this.value.set(text);
                            this.onChange(text);
                        }
                    }),
                    EditorView.domEventHandlers({
                        focus: (event) => this.focused.emit(event),
                        blur: (event) => {
                            this.onTouched();
                            this.blurred.emit(event);
                        }
                    })
                ]
            })
        });
        this.editorView.set(this.view);
    }

    /** Enter fora da lista de sugestões: `true` = tratado (não insere quebra de linha). */
    protected onEnter(event: KeyboardEvent): boolean {
        void event;

        return false;
    }
}
