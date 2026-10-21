import { acceptCompletion, autocompletion, completionStatus } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { Annotation, Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExtension, tooltips } from '@codemirror/view';
import { afterNextRender, booleanAttribute, computed, DestroyRef, Directive, effect, ElementRef, inject, input, model, output, signal, untracked } from '@angular/core';
import type { ControlValueAccessor } from '@angular/forms';
import { draftKey, RequestDraftsState } from '@/app/core/state/request-drafts.state';
import { ResponsesState } from '@/app/core/state/responses.state';
import { TemplateContextService } from '@/app/core/templating/template-context.service';
import { TemplateScope } from '@/app/core/templating/template-scope';
import { inspectTag, jsonPaths, parseSetCookie, requestSnapshot, tokenize, type MessageSnapshot, type MessageTarget } from '@shared/templating';
import { completionData, templateCompletions, type MessageSuggestions, type TemplateCompletionData } from './template-completions';
import { tagInspector, templateExtensions } from './template-extensions';
import { templateTheme } from './template-theme';

/** Mudança vinda de fora (`writeValue`, `[(value)]`): não volta como `onChange`. */
const external = Annotation.define<boolean>();

const ICONS: Record<string, string> = { variable: 'pi-at', secret: 'pi-lock', function: 'pi-bolt', namespace: 'pi-angle-right', property: 'pi-circle-fill', request: 'pi-link', value: 'pi-minus' };

const unique = (items: string[]): string[] => [...new Set(items)];

function suggestionsOf(snapshot: MessageSnapshot, title: string): MessageSuggestions {
    let body: unknown;

    try {
        body = JSON.parse(snapshot.bodyEncoding === 'utf8' ? snapshot.body : '');
    } catch {
        body = undefined;
    }

    const names = (pairs: Array<[string, string]> = []): string[] => unique(pairs.map(([name]) => name));
    const cookies =
        snapshot.kind === 'response'
            ? snapshot.headers.filter(([name]) => name.toLowerCase() === 'set-cookie').flatMap(([, value]) => parseSetCookie(value)?.name ?? [])
            : (snapshot.headers.find(([name]) => name.toLowerCase() === 'cookie')?.[1] ?? '').split(';').flatMap((part) => part.split('=')[0]?.trim() || []);

    return { title, paths: body === undefined ? [] : jsonPaths(body), headers: names(snapshot.headers), cookies: unique(cookies), params: names(snapshot.params), forms: names(snapshot.forms) };
}

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

    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    private readonly scope = inject(TemplateScope, { optional: true });
    private readonly templates = inject(TemplateContextService);
    private readonly responses = inject(ResponsesState);
    private readonly drafts = inject(RequestDraftsState);
    private readonly formDisabled = signal(false);
    private readonly config = new Compartment();
    private readonly data = new Compartment();
    private view: EditorView | null = null;
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

        return [EditorView.contentAttributes.of(attributes), EditorView.editable.of(!disabled), EditorState.readOnly.of(disabled || this.readonly()), ...(this.placeholder() ? [placeholderExtension(this.placeholder())] : [])];
    }

    private completionSource(): TemplateCompletionData {
        const collectionId = this.collectionId();
        const scopes = this.validation().scopes;
        const requestPath = this.scope?.requestPath() ?? null;

        return {
            variables: () => scopes.entries(),
            requests: () => this.templates.requests(collectionId),
            message: (target: MessageTarget) => {
                if (!collectionId) {
                    return null;
                }

                const entry = target.ref ? this.templates.findRequest(collectionId, target.ref) : null;
                const path = target.ref ? entry?.path : requestPath;

                if (!path) {
                    return null;
                }

                if (target.kind === 'response') {
                    const snapshot = this.responses.lastResponse(collectionId, path);

                    return snapshot ? suggestionsOf(snapshot, `${entry?.name ?? path} · ${snapshot.status} · last response`) : null;
                }

                const definition = this.drafts.draft(draftKey(collectionId, path));

                return definition ? suggestionsOf(requestSnapshot(definition), entry?.name ?? 'This request') : null;
            }
        };
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

                return this.onEnter(event);
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
    }

    /** Enter fora da lista de sugestões: `true` = tratado (não insere quebra de linha). */
    protected onEnter(event: KeyboardEvent): boolean {
        void event;

        return false;
    }
}
