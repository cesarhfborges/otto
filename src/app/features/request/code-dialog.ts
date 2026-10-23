import { Component, effect, inject, input, model, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CODEGEN_TARGETS, type CodegenTarget, generateCode } from '@shared/http/codegen';
import type { EntityId, RequestDefinition } from '@shared/models';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { ResponsesState } from '../../core/state/responses.state';
import { CodeEditor } from '../../shared/code-editor';
import { LARGE_DIALOG_CONTENT, LARGE_DIALOG_STYLE } from '../../shared/dialog-size';

const TARGET_KEY = 'otto.codegen.target';

function savedTarget(): CodegenTarget {
    try {
        const saved = localStorage.getItem(TARGET_KEY);

        return CODEGEN_TARGETS.find((target) => target.id === saved)?.id ?? 'curl';
    } catch {
        return 'curl';
    }
}

/** Código equivalente à requisição (cURL, fetch, Python…), gerado localmente. */
@Component({
    selector: 'app-code-dialog',
    imports: [DialogModule, ButtonModule, CheckboxModule, MessageModule, SelectModule, FormsModule, CodeEditor],
    template: `
        <p-dialog
            closeAriaLabel="Close"
            header="Generate Code"
            [modal]="true"
            [visible]="visible()"
            (visibleChange)="visible.set($event)"
            [style]="dialogStyle"
            [contentStyleClass]="dialogContent"
            [resizable]="false"
            [maximizable]="false"
            [draggable]="false"
            appendTo="body"
        >
            <div class="flex min-h-0 flex-1 flex-col gap-3">
                <div class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
                    <div class="flex items-center gap-2">
                        <label for="codegen-target" class="text-sm font-medium">Language</label>
                        <p-select inputId="codegen-target" [options]="targets" optionLabel="label" optionValue="id" [ngModel]="target()" (ngModelChange)="setTarget($event)" size="small" />
                    </div>
                    <div class="flex items-center gap-2">
                        <p-checkbox inputId="codegen-resolve" [binary]="true" [ngModel]="resolve()" (ngModelChange)="resolve.set($event)" />
                        <label for="codegen-resolve" class="text-sm">Resolve variables</label>
                    </div>
                </div>
                <p class="m-0 shrink-0 text-xs text-muted-color">
                    Secret variables are never written out: they stay as <code>{{ secretExample }}</code
                    >. Scripts are not run.
                </p>

                @for (problem of problems(); track problem) {
                    <p-message class="shrink-0" severity="warn" size="small">{{ problem }}</p-message>
                }

                <app-code-editor class="!min-h-0 flex-1" inputId="codegen-code" [value]="code()" language="plaintext" readonly />
            </div>
            <ng-template #footer>
                <p-button label="Close" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
                <p-button label="Copy" icon="pi pi-copy" [disabled]="!code()" (onClick)="copy()" />
            </ng-template>
        </p-dialog>
    `
})
export class CodeDialog {
    readonly visible = model(false);
    readonly collectionId = input.required<EntityId>();
    readonly path = input.required<string>();
    readonly request = input.required<RequestDefinition>();

    private readonly responses = inject(ResponsesState);
    private readonly messages = inject(MessageService);

    protected readonly targets = [...CODEGEN_TARGETS];
    protected readonly dialogStyle = LARGE_DIALOG_STYLE;
    protected readonly dialogContent = LARGE_DIALOG_CONTENT;
    protected readonly secretExample = '{{$.token}}';
    protected readonly target = signal<CodegenTarget>(savedTarget());
    protected readonly resolve = signal(true);
    protected readonly code = signal('');
    protected readonly problems = signal<string[]>([]);

    constructor() {
        effect(() => {
            if (!this.visible()) {
                return;
            }

            const args = [this.collectionId(), this.path(), this.request(), this.resolve(), this.target()] as const;

            untracked(() => void this.generate(...args));
        });
    }

    protected setTarget(target: CodegenTarget): void {
        this.target.set(target);

        try {
            localStorage.setItem(TARGET_KEY, target);
        } catch {
            // Sem localStorage: só não lembra a escolha.
        }
    }

    protected copy(): void {
        void navigator.clipboard.writeText(this.code()).then(() => this.messages.add({ severity: 'success', summary: 'Code copied', life: 2000 }));
    }

    private async generate(collectionId: EntityId, path: string, definition: RequestDefinition, resolve: boolean, target: CodegenTarget): Promise<void> {
        try {
            const { request, problems } = await this.responses.preview(collectionId, path, definition, resolve);

            this.code.set(generateCode(request, target));
            this.problems.set(problems);
        } catch (error) {
            this.code.set('');
            this.problems.set([ipcErrorMessage(error)]);
        }
    }
}
