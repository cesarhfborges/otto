import { Component, computed, effect, inject, model } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { type BodyType, type KeyValue, type MultipartField, type RequestBody } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectButtonModule } from 'primeng/selectbutton';
import { DialogGateway } from '../../core/ports';
import { CodeEditor } from '../../shared/code-editor';
import { formatJson, formatText, formatXml, validateBody, type FormatResult } from './body-format';
import { KeyValueEditor, type EditableRow } from './key-value-editor';

const BODY_LABELS: Record<BodyType, string> = {
    'multipart-form': 'Multipart Form',
    'form-urlencoded': 'Form URL Encoded',
    json: 'JSON',
    text: 'Text',
    xml: 'XML',
    binary: 'File / Binary',
    none: 'No Body'
};

const TEXT_PLACEHOLDERS = { json: '{\n  "name": "{{name}}"\n}', xml: '<user>\n  <name>{{name}}</name>\n</user>', text: 'Plain text' } as const;

type TextBodyType = keyof typeof TEXT_PLACEHOLDERS;

const isTextType = (type: BodyType): type is TextBodyType => type === 'json' || type === 'xml' || type === 'text';

/**
 * Corpo da requisição: tipo (segmentos) e o editor correspondente. Ao trocar de tipo
 * o conteúdo é aproveitado quando possível (texto ↔ texto, campos ↔ campos).
 */
@Component({
    selector: 'app-body-editor',
    imports: [ReactiveFormsModule, SelectButtonModule, ButtonModule, InputTextModule, MessageModule, KeyValueEditor, CodeEditor],
    template: `
        <p-selectbutton [options]="types" optionLabel="label" optionValue="value" [allowEmpty]="false" size="small" [formControl]="typeControl" ariaLabelledBy="body-type-label" class="flex-wrap [&_.p-togglebutton]:whitespace-nowrap" />
        <span id="body-type-label" class="sr-only">Body type</span>

        <div class="mt-3">
            @switch (body().type) {
                @case ('none') {
                    <p class="m-0 text-sm text-muted-color">This request is sent without a body.</p>
                }
                @case ('form-urlencoded') {
                    <app-key-value-editor [items]="fields()" (itemsChange)="setFields($event)" label="Form fields" addLabel="Add Field" />
                }
                @case ('multipart-form') {
                    <app-key-value-editor [items]="fields()" (itemsChange)="setFields($event)" label="Multipart fields" addLabel="Add Field" [allowFiles]="true" />
                }
                @case ('binary') {
                    <div class="flex flex-col gap-2">
                        <label for="body-file" class="text-sm font-medium">File</label>
                        <div class="flex gap-2">
                            <input pInputText id="body-file" class="min-w-0 flex-1 font-mono !text-sm" [value]="file()" readonly placeholder="No file selected" aria-describedby="body-file-help" />
                            <p-button label="Choose File…" icon="pi pi-folder-open" severity="secondary" size="small" (onClick)="chooseFile()" />
                            @if (file()) {
                                <p-button label="Clear" severity="secondary" [text]="true" size="small" (onClick)="body.set({ type: 'binary', file: '' })" />
                            }
                        </div>
                        <small id="body-file-help" class="text-muted-color">The file is read when the request is sent. Content-Type defaults to application/octet-stream unless set in Headers.</small>
                    </div>
                }
                @default {
                    <div class="flex flex-col gap-2">
                        <div class="flex items-center gap-2">
                            <label for="body-content" class="text-sm font-medium">{{ typeLabel() }} content</label>
                            <p-button label="Pretty" icon="pi pi-align-left" size="small" severity="secondary" [text]="true" class="ml-auto" (onClick)="prettify()" />
                        </div>
                        <app-code-editor
                            inputId="body-content"
                            [value]="content()"
                            (valueChange)="setContent($event)"
                            [language]="language()"
                            [placeholder]="placeholder()"
                            [invalid]="!!problem()"
                            [describedBy]="problem() ? 'body-content-error' : null"
                        />
                        @if (problem(); as message) {
                            <small id="body-content-error" class="text-red-700 dark:text-red-400" aria-live="polite">{{ message }}</small>
                        }
                    </div>
                }
            }
        </div>
    `,
    host: { class: 'block' }
})
export class BodyEditor {
    readonly body = model.required<RequestBody>();

    private readonly dialogs = inject(DialogGateway);

    protected readonly typeControl = new FormControl<BodyType>('none', { nonNullable: true });

    constructor() {
        // O segmento reflete o modelo; escolher outro tipo converte o corpo.
        effect(() => this.typeControl.setValue(this.body().type, { emitEvent: false }));
        this.typeControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((type) => this.changeType(type));
    }

    /** Na ordem de uso: formulários, textos, arquivo e, por último, sem corpo. */
    protected readonly types = (['multipart-form', 'form-urlencoded', 'json', 'text', 'xml', 'binary', 'none'] as const satisfies readonly BodyType[]).map((value) => ({ value, label: BODY_LABELS[value] }));
    protected readonly typeLabel = computed(() => BODY_LABELS[this.body().type]);
    protected readonly fields = computed<EditableRow[]>(() => {
        const body = this.body();

        return body.type === 'form-urlencoded' || body.type === 'multipart-form' ? body.fields : [];
    });
    protected readonly content = computed(() => {
        const body = this.body();

        return 'content' in body ? body.content : '';
    });
    protected readonly file = computed(() => {
        const body = this.body();

        return body.type === 'binary' ? body.file : '';
    });
    protected readonly placeholder = computed(() => {
        const type = this.body().type;

        return isTextType(type) ? TEXT_PLACEHOLDERS[type] : '';
    });
    protected readonly language = computed(() => {
        const type = this.body().type;

        return type === 'json' || type === 'xml' ? type : null;
    });
    /** Erro de sintaxe (JSON/XML) mostrado enquanto digita. */
    protected readonly problem = computed(() => {
        const type = this.body().type;

        return isTextType(type) ? validateBody(type, this.content()) : null;
    });

    protected changeType(type: BodyType): void {
        const current = this.body();

        if (current.type === type) {
            return;
        }

        const previousFields: KeyValue[] = current.type === 'form-urlencoded' || current.type === 'multipart-form' ? current.fields : [];

        switch (type) {
            case 'none':
                this.body.set({ type });
                break;
            case 'json':
            case 'text':
            case 'xml':
                this.body.set({ type, content: 'content' in current ? current.content : '' });
                break;
            case 'form-urlencoded':
                this.body.set({ type, fields: previousFields.map(({ key, value, enabled, description }) => ({ key, value, enabled, ...(description && { description }) })) });
                break;
            case 'multipart-form':
                this.body.set({ type, fields: previousFields.map((field): MultipartField => ({ ...field, kind: (field as Partial<MultipartField>).kind ?? 'text' })) });
                break;
            case 'binary':
                this.body.set({ type, file: '' });
                break;
        }
    }

    protected setFields(fields: EditableRow[]): void {
        const type = this.body().type;

        if (type === 'multipart-form') {
            this.body.set({ type, fields: fields.map((field) => ({ ...field, kind: field.kind ?? 'text' })) });
        } else if (type === 'form-urlencoded') {
            this.body.set({ type, fields: fields.map(({ kind: _kind, ...field }) => field) });
        }
    }

    protected setContent(content: string): void {
        const type = this.body().type;

        if (isTextType(type)) {
            this.body.set({ type, content });
        }
    }

    protected prettify(): void {
        const type = this.body().type;

        if (!isTextType(type)) {
            return;
        }

        const formatters: Record<TextBodyType, (source: string) => FormatResult> = { json: formatJson, xml: formatXml, text: formatText };
        const result = formatters[type](this.content());

        // Com erro, o conteúdo fica como está e o aviso abaixo do editor explica o motivo.
        if (result.ok) {
            this.setContent(result.text);
        }
    }

    protected async chooseFile(): Promise<void> {
        const file = await this.dialogs.pickFile('Choose the file to send as the body');

        if (file) {
            this.body.set({ type: 'binary', file });
        }
    }
}
