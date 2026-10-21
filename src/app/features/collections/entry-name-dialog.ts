import { Component, effect, type ElementRef, model, signal, viewChild } from '@angular/core';
import { type AbstractControl, FormControl, FormsModule, ReactiveFormsModule, type ValidationErrors, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { EnterSubmit } from '../../shared/enter-submit.directive';

/** O que o diálogo pede: título, nome inicial e a ação executada com o nome escolhido. */
export interface EntryNameRequest {
    header: string;
    acceptLabel: string;
    acceptIcon: string;
    name: string;
    /** Pastas viram diretórios: o nome não pode ter separadores nem começar com ponto. */
    folder: boolean;
    submit: (name: string) => Promise<void>;
}

const FOLDER_NAME = /^[^./\\][^/\\]*$/;

/** Pede o nome de um item da coleção (renomear ou duplicar pasta/requisição). */
@Component({
    selector: 'app-entry-name-dialog',
    imports: [DialogModule, ReactiveFormsModule, EnterSubmit, InputTextModule, ButtonModule, MessageModule, FormsModule],
    template: `
        <p-dialog closeAriaLabel="Close" [header]="request()?.header ?? ''" [modal]="true" [visible]="!!request()" (visibleChange)="!$event && close()" (onShow)="focusName()" [style]="{ width: '28rem' }" [draggable]="false" appendTo="body">
            <form appEnterSubmit (ngSubmit)="submit()" class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                    <label for="entry-name" class="font-medium">Name</label>
                    <input #nameInput pInputText id="entry-name" [formControl]="name" autocomplete="off" [attr.aria-describedby]="request()?.folder ? 'entry-name-help' : null" />
                    @if (request()?.folder) {
                        <small id="entry-name-help" class="text-muted-color">Cannot contain "/" or "\\" or start with ".".</small>
                    }
                </div>
                @if (error(); as message) {
                    <p-message severity="error"
                        ><span role="alert">{{ message }}</span></p-message
                    >
                }
            </form>
            <ng-template #footer>
                <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="close()" />
                <p-button [label]="request()?.acceptLabel ?? 'OK'" [icon]="request()?.acceptIcon ?? 'pi pi-check'" (onClick)="submit()" [loading]="busy()" [disabled]="name.invalid" />
            </ng-template>
        </p-dialog>
    `
})
export class EntryNameDialog {
    readonly request = model<EntryNameRequest | null>(null);

    private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

    protected readonly busy = signal(false);
    protected readonly error = signal<string | null>(null);
    protected readonly name = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120), (control) => this.validateName(control)] });

    constructor() {
        // Cada abertura começa com o nome sugerido e sem erro anterior.
        effect(() => {
            const request = this.request();

            if (request) {
                this.name.reset(request.name);
                this.error.set(null);
            }
        });
    }

    protected focusName(): void {
        this.nameInput()?.nativeElement.select();
    }

    protected async submit(): Promise<void> {
        const request = this.request();

        if (!request || this.name.invalid || this.busy()) {
            return;
        }

        this.busy.set(true);
        this.error.set(null);

        try {
            await request.submit(this.name.value.trim());
            this.request.set(null);
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        } finally {
            this.busy.set(false);
        }
    }

    protected close(): void {
        if (!this.busy()) {
            this.request.set(null);
        }
    }

    private validateName(control: AbstractControl<string>): ValidationErrors | null {
        const value = control.value.trim();

        if (!value) {
            return { required: true };
        }

        return this.request()?.folder && !FOLDER_NAME.test(value) ? { pattern: true } : null;
    }
}
