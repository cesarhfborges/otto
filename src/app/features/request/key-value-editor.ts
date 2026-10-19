import { Component, inject, input, model } from '@angular/core';
import type { KeyValue } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { DialogGateway } from '../../core/ports';

/** Linha editável; `kind` só existe em formulários multipart (texto ou arquivo). */
export type EditableRow = KeyValue & { kind?: 'text' | 'file' };

/**
 * Tabela de pares chave/valor: habilitar, nome, valor e descrição (só para quem lê;
 * não é enviada). Usada em Params, Headers e nos corpos de formulário.
 */
@Component({
    selector: 'app-key-value-editor',
    imports: [ButtonModule, InputTextModule],
    template: `
        <table class="w-full border-collapse text-sm">
            <caption class="sr-only">
                {{
                    label()
                }}
            </caption>
            <thead>
                <tr class="text-left text-xs text-muted-color">
                    <th scope="col" class="w-8 border-b border-surface-200 py-1.5 font-medium dark:border-surface-700"><span class="sr-only">Enabled</span></th>
                    <th scope="col" class="w-1/4 border-b border-surface-200 py-1.5 font-medium dark:border-surface-700">Name</th>
                    @if (allowFiles()) {
                        <th scope="col" class="w-24 border-b border-surface-200 py-1.5 font-medium dark:border-surface-700">Type</th>
                    }
                    <th scope="col" class="border-b border-surface-200 py-1.5 font-medium dark:border-surface-700">Value</th>
                    <th scope="col" class="w-1/4 border-b border-surface-200 py-1.5 font-medium dark:border-surface-700">Description</th>
                    <th scope="col" class="w-9 border-b border-surface-200 py-1.5 dark:border-surface-700"><span class="sr-only">Remove</span></th>
                </tr>
            </thead>
            <tbody>
                @for (row of items(); track $index; let i = $index) {
                    <tr [class.text-muted-color]="!row.enabled">
                        <td class="border-b border-surface-100 py-1 dark:border-surface-800">
                            <input
                                type="checkbox"
                                class="h-4 w-4 cursor-pointer accent-[var(--p-primary-color)]"
                                [checked]="row.enabled"
                                [attr.aria-label]="'Send ' + (row.key || 'row ' + (i + 1))"
                                (change)="patch(i, { enabled: $any($event.target).checked })"
                            />
                        </td>
                        <td class="border-b border-surface-100 py-1 pr-2 dark:border-surface-800">
                            <input
                                pInputText
                                pSize="small"
                                class="w-full font-mono !text-sm"
                                [value]="row.key"
                                placeholder="name"
                                autocomplete="off"
                                spellcheck="false"
                                [attr.aria-label]="'Name of row ' + (i + 1)"
                                (input)="patch(i, { key: $any($event.target).value })"
                            />
                        </td>
                        @if (allowFiles()) {
                            <td class="border-b border-surface-100 py-1 pr-2 dark:border-surface-800">
                                <select class="otto-native-select w-full" [value]="row.kind ?? 'text'" [attr.aria-label]="'Type of row ' + (i + 1)" (change)="setKind(i, $any($event.target).value)">
                                    @for (kind of kinds; track kind.value) {
                                        <option [value]="kind.value">{{ kind.label }}</option>
                                    }
                                </select>
                            </td>
                        }
                        <td class="border-b border-surface-100 py-1 pr-2 dark:border-surface-800">
                            @if (row.kind === 'file') {
                                <span class="flex items-center gap-1">
                                    <input pInputText pSize="small" class="min-w-0 flex-1 font-mono !text-sm" [value]="row.value" readonly placeholder="No file selected" [attr.aria-label]="'File of row ' + (i + 1)" />
                                    <p-button icon="pi pi-folder-open" size="small" severity="secondary" [text]="true" [ariaLabel]="'Choose file for row ' + (i + 1)" (onClick)="chooseFile(i)" />
                                </span>
                            } @else {
                                <input
                                    pInputText
                                    pSize="small"
                                    class="w-full font-mono !text-sm"
                                    [value]="row.value"
                                    placeholder="value"
                                    autocomplete="off"
                                    spellcheck="false"
                                    [attr.aria-label]="'Value of row ' + (i + 1)"
                                    (input)="patch(i, { value: $any($event.target).value })"
                                />
                            }
                        </td>
                        <td class="border-b border-surface-100 py-1 pr-2 dark:border-surface-800">
                            <input
                                pInputText
                                pSize="small"
                                class="w-full !text-sm"
                                [value]="row.description ?? ''"
                                placeholder="description"
                                autocomplete="off"
                                [attr.aria-label]="'Description of row ' + (i + 1)"
                                (input)="patch(i, { description: $any($event.target).value })"
                            />
                        </td>
                        <td class="border-b border-surface-100 py-1 dark:border-surface-800">
                            <button type="button" class="otto-icon-button" [attr.aria-label]="'Remove ' + (row.key || 'row ' + (i + 1))" (click)="remove(i)">
                                <i class="pi pi-trash text-xs" aria-hidden="true"></i>
                            </button>
                        </td>
                    </tr>
                }
            </tbody>
        </table>
        <p-button [label]="addLabel()" icon="pi pi-plus" size="small" severity="secondary" [text]="true" styleClass="mt-1" (onClick)="add()" />
    `,
    host: { class: 'block' }
})
export class KeyValueEditor {
    readonly items = model.required<EditableRow[]>();
    /** Nome da tabela para leitores de tela (ex.: "Query parameters"). */
    readonly label = input.required<string>();
    readonly addLabel = input('Add');
    /** Formulário multipart: cada linha pode ser texto ou arquivo. */
    readonly allowFiles = input(false);

    private readonly dialogs = inject(DialogGateway);

    protected readonly kinds = [
        { label: 'Text', value: 'text' },
        { label: 'File', value: 'file' }
    ];

    protected add(): void {
        this.items.update((rows) => [...rows, { key: '', value: '', enabled: true, ...(this.allowFiles() && { kind: 'text' as const }) }]);
        // Foco no nome da nova linha.
        queueMicrotask(() => {
            const inputs = document.activeElement?.closest('app-key-value-editor')?.querySelectorAll<HTMLInputElement>('tbody tr:last-child input[placeholder="name"]');

            inputs?.[inputs.length - 1]?.focus();
        });
    }

    protected remove(index: number): void {
        this.items.update((rows) => rows.filter((_, i) => i !== index));
    }

    protected patch(index: number, changes: Partial<EditableRow>): void {
        this.items.update((rows) => rows.map((row, i) => (i === index ? { ...row, ...changes } : row)));
    }

    protected setKind(index: number, kind: 'text' | 'file'): void {
        // Trocar o tipo limpa o valor (texto não é um caminho de arquivo e vice-versa).
        this.patch(index, { kind, value: '' });
    }

    protected async chooseFile(index: number): Promise<void> {
        const file = await this.dialogs.pickFile('Choose a file to upload');

        if (file) {
            this.patch(index, { value: file });
        }
    }
}
