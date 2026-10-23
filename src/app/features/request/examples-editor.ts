import { Component, computed, inject, input, linkedSignal, model, signal } from '@angular/core';
import { emptyExample, type EntityId, type KeyValue, type ResponseExample } from '@shared/models';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmState } from '../../core/state/confirm.state';
import { MockState } from '../../core/state/mock.state';
import { CodeEditor } from '../../shared/code-editor';
import { KeyValueEditor } from './key-value-editor';

/** Cor do status HTTP (texto), com contraste AA nos dois temas. */
function statusClass(status: number): string {
    if (status < 300) {
        return 'text-green-700 dark:text-green-400';
    }

    if (status < 400) {
        return 'text-sky-700 dark:text-sky-400';
    }

    return status < 500 ? 'text-amber-700 dark:text-amber-400' : 'text-red-700 dark:text-red-400';
}

/** Respostas de exemplo da requisição, servidas pelo mock server da coleção. */
@Component({
    selector: 'app-examples-editor',
    imports: [ButtonModule, InputTextModule, TooltipModule, CodeEditor, KeyValueEditor],
    template: `
        <!-- Rota e estado do mock: responde "onde e como isso é servido?" -->
        <div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-surface-200 px-3 py-2 text-sm dark:border-surface-700" role="status">
            <span class="text-muted-color">Mock route</span>
            <code class="font-mono">{{ route() }}</code>
            <span class="flex-1"></span>
            @if (server(); as running) {
                <span class="flex items-center gap-2"><i class="pi pi-circle-fill text-[0.5rem] text-green-700 dark:text-green-400" aria-hidden="true"></i>Mock server running</span>
                <button type="button" class="otto-icon-button !h-6 !w-6" aria-label="Copy the mock URL of this request" pTooltip="Copy mock URL" (click)="copy(running.url + path())">
                    <i class="pi pi-copy text-xs" aria-hidden="true"></i>
                </button>
            } @else {
                <span class="flex items-center gap-2 text-muted-color"><i class="pi pi-circle text-[0.5rem]" aria-hidden="true"></i>Mock server stopped · start it in the collection's <em>Mock Server</em> tab</span>
            }
        </div>

        @if (examples().length) {
            <div class="flex min-h-0 flex-1 gap-4">
                <!-- Lista de exemplos -->
                <nav class="flex w-56 shrink-0 flex-col gap-1 overflow-auto" aria-label="Response examples">
                    <ul class="m-0 flex list-none flex-col gap-1 p-0">
                        @for (example of examples(); track $index) {
                            <li class="group relative">
                                <button
                                    type="button"
                                    class="grid h-14 w-full cursor-pointer grid-cols-[2.25rem_minmax(0,1fr)] content-center items-center gap-x-2 gap-y-0.5 rounded-md border pl-3 pr-9 text-left text-sm leading-5 transition-colors"
                                    [class]="$index === selected() ? 'border-primary bg-primary-50 dark:bg-primary-950' : 'border-transparent hover:bg-surface-100 dark:hover:bg-surface-800'"
                                    [attr.aria-current]="$index === selected() ? 'true' : null"
                                    (click)="selected.set($index)"
                                >
                                    <span class="font-mono font-semibold tabular-nums" [class]="statusClass(example.status)">{{ example.status }}</span>
                                    <span class="truncate font-medium">{{ example.name || 'Untitled' }}</span>
                                    <!-- Segunda linha sempre presente: todos os itens com a mesma altura e alinhamento. -->
                                    <span class="col-start-2 flex items-center gap-3 text-xs leading-4 text-muted-color">
                                        @if ($first) {
                                            <span class="flex items-center gap-1"><i class="pi pi-star-fill text-[0.625rem]" aria-hidden="true"></i>Default</span>
                                        } @else {
                                            <span>Alternative</span>
                                        }
                                        @if (example.delayMs) {
                                            <span class="flex items-center gap-1"><i class="pi pi-clock text-[0.625rem]" aria-hidden="true"></i>{{ example.delayMs }} ms</span>
                                        }
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    class="otto-icon-button absolute right-1.5 top-1/2 -translate-y-1/2 !h-6 !w-6 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                                    [attr.aria-label]="'Remove example ' + (example.name || 'Untitled')"
                                    pTooltip="Remove example"
                                    (click)="remove($index)"
                                >
                                    <i class="pi pi-trash text-xs text-red-700 dark:text-red-400" aria-hidden="true"></i>
                                </button>
                            </li>
                        }
                    </ul>
                    <p-button label="Add example" icon="pi pi-plus" size="small" severity="secondary" [text]="true" styleClass="w-full justify-start" (onClick)="add()" />
                </nav>

                <!-- Exemplo selecionado -->
                @if (current(); as example) {
                    <section class="flex min-h-0 min-w-0 flex-1 flex-col gap-3" aria-label="Selected example">
                        <div class="grid grid-cols-[minmax(0,1fr)_7rem_8rem] items-end gap-3">
                            <div class="flex flex-col gap-1">
                                <label for="example-name" class="text-sm font-medium">Name</label>
                                <input pInputText pSize="small" id="example-name" autocomplete="off" [value]="example.name" (input)="patch({ name: $any($event.target).value })" />
                            </div>
                            <div class="flex flex-col gap-1">
                                <label for="example-status" class="text-sm font-medium">Status</label>
                                <input pInputText pSize="small" id="example-status" type="number" min="100" max="599" [value]="example.status" (input)="setNumber('status', $any($event.target).value, 100, 599)" />
                            </div>
                            <div class="flex flex-col gap-1">
                                <label for="example-delay" class="text-sm font-medium">Delay (ms)</label>
                                <input pInputText pSize="small" id="example-delay" type="number" min="0" max="60000" step="100" [value]="example.delayMs" (input)="setNumber('delayMs', $any($event.target).value, 0, 60000)" />
                            </div>
                        </div>

                        <div class="flex items-center gap-1 border-b border-surface-200 dark:border-surface-700" role="group" aria-label="Example part">
                            <button type="button" class="otto-example-pane" [class.otto-example-pane-active]="pane() === 'body'" [attr.aria-pressed]="pane() === 'body'" (click)="pane.set('body')">Body</button>
                            <button type="button" class="otto-example-pane" [class.otto-example-pane-active]="pane() === 'headers'" [attr.aria-pressed]="pane() === 'headers'" (click)="pane.set('headers')">
                                Headers <span class="text-xs text-muted-color">({{ example.headers.length }})</span>
                            </button>
                            <span class="flex-1"></span>
                            @if (selected() !== 0) {
                                <p-button label="Make default" icon="pi pi-star" size="small" severity="secondary" [text]="true" (onClick)="makeDefault()" />
                            }
                        </div>

                        @if (pane() === 'body') {
                            <app-code-editor class="min-h-48 flex-1" inputId="example-body" [language]="language()" [value]="example.body" (valueChange)="patch({ body: $event })" placeholder='{ "id": 1 }' />
                        } @else {
                            <app-key-value-editor [items]="example.headers" (itemsChange)="setHeaders($event)" label="Example response headers" addLabel="Add Header" />
                        }
                    </section>
                }
            </div>
        } @else {
            <div class="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-8 text-center">
                <i class="pi pi-server text-3xl text-muted-color" aria-hidden="true"></i>
                <h3 class="m-0 text-base font-semibold">No response examples</h3>
                <p class="m-0 max-w-md text-sm text-muted-color">
                    Examples are the responses the collection's mock server returns for <code>{{ route() }}</code>. Create one by hand, or send the request and click <em>Save as example</em> on the response.
                </p>
                <p-button label="Add example" icon="pi pi-plus" size="small" (onClick)="add()" />
            </div>
        }

        <details class="mt-3 shrink-0 text-xs text-muted-color">
            <summary class="cursor-pointer">How examples are chosen and templated</summary>
            <ul class="m-0 mt-2 flex list-disc flex-col gap-1 pl-5">
                <li>The <strong>default</strong> (first) example answers every call. Pick another by name with the <code>X-Otto-Example</code> header or <code>?__example=</code>.</li>
                <li>
                    Bodies read the call with <code>{{ tpl('$params.id') }}</code>, <code>{{ tpl('$query.page') }}</code>, <code>{{ tpl('$header.authorization') }}</code>, <code>{{ tpl('$body.user.name') }}</code> and generate values with
                    <code>{{ tpl('$uuid') }}</code>, <code>{{ tpl('$now') }}</code>, <code>{{ tpl('$timestamp') }}</code>, <code>{{ tpl('$randomInt') }}</code>.
                </li>
            </ul>
        </details>
    `,
    styles: `
        .otto-example-pane {
            margin-bottom: -1px;
            padding: 0.375rem 0.75rem;
            border: 0;
            border-bottom: 2px solid transparent;
            background: transparent;
            color: var(--p-text-muted-color);
            font-size: 0.875rem;
            font-weight: 500;
            cursor: pointer;
        }

        .otto-example-pane:hover,
        .otto-example-pane-active {
            color: var(--p-text-color);
        }

        .otto-example-pane-active {
            border-bottom-color: var(--p-primary-color);
        }

        .otto-example-pane:focus-visible {
            outline: 2px solid var(--p-primary-color);
            outline-offset: -2px;
        }
    `,
    host: { class: 'flex min-h-0 flex-1 flex-col' }
})
export class ExamplesEditor {
    readonly examples = model.required<ResponseExample[]>();
    /** `MÉTODO /caminho` atendido pelo mock. */
    readonly route = input('');
    /** Caminho (com `:params`) para montar a URL copiável do mock. */
    readonly path = input('');
    readonly collectionId = input.required<EntityId>();

    private readonly confirm = inject(ConfirmState);
    private readonly mocks = inject(MockState);
    private readonly messages = inject(MessageService);

    protected readonly statusClass = statusClass;
    protected readonly server = computed(() => this.mocks.find(this.collectionId()));
    protected readonly pane = signal<'body' | 'headers'>('body');
    /** Exemplo em edição; volta ao primeiro quando a lista encolhe. */
    protected readonly selected = linkedSignal<number, number>({
        source: () => this.examples().length,
        computation: (length, previous) => (previous && previous.value < length ? previous.value : Math.max(0, length - 1))
    });
    protected readonly current = computed(() => this.examples()[this.selected()] ?? null);
    protected readonly language = computed(() => {
        const contentType = this.current()?.headers.find((header) => header.enabled && header.key.toLowerCase() === 'content-type')?.value ?? '';

        return /json/i.test(contentType) ? 'json' : /xml|html/i.test(contentType) ? 'xml' : 'plaintext';
    });

    protected tpl(expression: string): string {
        return `{{${expression}}}`;
    }

    protected add(): void {
        this.examples.update((examples) => [...examples, emptyExample(examples.length ? `Example ${examples.length + 1}` : 'Success')]);
        this.selected.set(this.examples().length - 1);
        this.pane.set('body');
    }

    protected patch(changes: Partial<ResponseExample>): void {
        const index = this.selected();

        this.examples.update((examples) => examples.map((example, i) => (i === index ? { ...example, ...changes } : example)));
    }

    protected setHeaders(headers: KeyValue[]): void {
        this.patch({ headers });
    }

    protected setNumber(field: 'status' | 'delayMs', raw: string, min: number, max: number): void {
        const value = Number(raw);

        if (Number.isInteger(value) && value >= min && value <= max) {
            this.patch({ [field]: value });
        }
    }

    protected makeDefault(): void {
        const index = this.selected();

        this.examples.update((examples) => [examples[index]!, ...examples.filter((_, i) => i !== index)]);
        this.selected.set(0);
    }

    protected async remove(index: number): Promise<void> {
        const example = this.examples()[index];

        if (example && (await this.confirm.askDelete({ header: 'Remove Example', message: `Remove the example "${example.name}"?`, acceptLabel: 'Remove' }))) {
            const selected = this.selected();

            this.examples.update((examples) => examples.filter((_, i) => i !== index));
            // Mantém o mesmo exemplo aberto quando outro, acima dele, é removido.
            if (index < selected) {
                this.selected.set(selected - 1);
            }
        }
    }

    protected copy(text: string): void {
        void navigator.clipboard.writeText(text).then(() => this.messages.add({ severity: 'success', summary: 'Copied', life: 2000 }));
    }
}
