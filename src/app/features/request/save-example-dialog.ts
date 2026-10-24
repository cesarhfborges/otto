import { Component, computed, input, linkedSignal, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { isMockRelevantHeader } from '@shared/http/mock-headers';
import type { ResponseExample } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';

/** Resposta (recebida ou do histórico) a ser guardada como exemplo do mock server. */
export interface ExampleSource {
    status: number;
    headers: ReadonlyArray<[string, string]>;
    body: string;
    name: string;
}

/** Confirma o "Save as example": nome do exemplo e quais headers da resposta manter. */
@Component({
    selector: 'app-save-example-dialog',
    imports: [DialogModule, ButtonModule, CheckboxModule, InputTextModule, FormsModule],
    template: `
        <p-dialog
            closeAriaLabel="Close"
            header="Save as Example"
            [modal]="true"
            [visible]="!!source()"
            (visibleChange)="!$event && source.set(null)"
            [style]="{ width: '32rem', maxWidth: 'calc(100vw - 2rem)' }"
            [resizable]="false"
            [draggable]="false"
            appendTo="body"
        >
            @if (source(); as res) {
                <form id="save-example-form" class="flex flex-col gap-4" (submit)="$event.preventDefault(); save()">
                    <p class="m-0 text-sm text-muted-color">The response becomes an example served by the collection's mock server for this request.</p>

                    <div class="flex flex-col gap-1">
                        <label for="save-example-name" class="text-sm font-medium">Name</label>
                        <input pInputText id="save-example-name" autocomplete="off" [value]="name()" (input)="name.set($any($event.target).value)" aria-describedby="save-example-name-help" />
                        <small id="save-example-name-help" class="text-muted-color">Status {{ res.status }}. Pick it on the mock with <code>X-Otto-Example</code>.</small>
                    </div>

                    <div class="flex flex-col gap-2">
                        <div class="flex items-center gap-2">
                            <p-checkbox inputId="save-example-keep-all" [binary]="true" [ngModel]="keepAll()" [ngModelOptions]="{ standalone: true }" (ngModelChange)="keepAll.set($event)" ariaDescribedBy="save-example-headers-help" />
                            <label for="save-example-keep-all" class="text-sm">Keep all headers</label>
                        </div>
                        <small id="save-example-headers-help" class="text-muted-color">
                            @if (keepAll()) {
                                All {{ res.headers.length }} response header(s) will be saved.
                            } @else {
                                {{ relevant().length }} of {{ res.headers.length }} header(s) kept; security, cache, CORS and transport headers are ignored.
                            }
                        </small>
                        @if (headers().length) {
                            <div class="max-h-48 overflow-auto rounded-md border border-surface-200 dark:border-surface-700" tabindex="0" role="region" aria-label="Headers that will be saved">
                                <dl class="m-0 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] font-mono text-xs leading-5">
                                    @for (header of headers(); track $index) {
                                        <dt class="truncate border-b border-surface-200 px-2 py-1 font-semibold text-color dark:border-surface-700" [title]="header[0]">{{ header[0] }}</dt>
                                        <dd class="m-0 truncate border-b border-surface-200 px-2 py-1 text-muted-color dark:border-surface-700" [title]="header[1]">{{ header[1] }}</dd>
                                    }
                                </dl>
                            </div>
                        }
                    </div>
                </form>
            }
            <ng-template #footer>
                <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="source.set(null)" />
                <p-button label="Save example" icon="pi pi-save" (onClick)="save()" [disabled]="!name().trim()" />
            </ng-template>
        </p-dialog>
    `
})
export class SaveExampleDialog {
    /** Resposta em edição; `null` fecha o diálogo. */
    readonly source = model<ExampleSource | null>(null);
    /** Nomes já usados na requisição (para sugerir um nome livre). */
    readonly taken = input<readonly string[]>([]);
    readonly saved = output<ResponseExample>();

    /** Volta a desmarcado a cada resposta aberta no diálogo. */
    protected readonly keepAll = linkedSignal({ source: this.source, computation: () => false });
    protected readonly name = linkedSignal(() => {
        const source = this.source();
        const taken = new Set(this.taken());
        const base = source?.name || `Example ${taken.size + 1}`;
        let name = base;

        for (let i = 2; taken.has(name); i++) {
            name = `${base} (${i})`;
        }

        return name;
    });
    protected readonly relevant = computed(() => (this.source()?.headers ?? []).filter(([key]) => isMockRelevantHeader(key)));
    protected readonly headers = computed(() => (this.keepAll() ? (this.source()?.headers ?? []) : this.relevant()));

    protected save(): void {
        const source = this.source();
        const name = this.name().trim();

        if (!source || !name) {
            return;
        }

        let body = source.body;

        try {
            body = JSON.stringify(JSON.parse(body), null, 2);
        } catch {
            // Não é JSON: guarda como veio.
        }

        this.saved.emit({ name, status: source.status, headers: this.headers().map(([key, value]) => ({ key, value, enabled: true })), body, delayMs: 0 });
        this.source.set(null);
    }
}
