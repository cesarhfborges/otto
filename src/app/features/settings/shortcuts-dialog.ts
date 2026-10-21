import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { COMMAND_CATEGORIES, COMMANDS } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { KeybindingService } from '../../core/keyboard/keybinding.service';
import { UiState } from '../../core/state/ui.state';
import { SettingsDialog } from './settings-dialog.service';

const fold = (text: string): string => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Ajuda rápida (`Mod+Shift+/`): lista os atalhos atuais, só leitura, com link para personalizar. */
@Component({
    selector: 'app-shortcuts-dialog',
    imports: [DialogModule, ButtonModule, InputTextModule, FormsModule],
    template: `
        @if (ui.shortcutsDialog()) {
            <p-dialog
                closeAriaLabel="Close"
                header="Keyboard Shortcuts"
                maskStyleClass="shortcuts-dialog-custom"
                appendTo="#main-content"
                [modal]="true"
                [visible]="true"
                (visibleChange)="!$event && close()"
                [style]="{ width: '40rem' }"
                [draggable]="false"
            >
                <label for="shortcuts-help-search" class="sr-only">Search shortcuts</label>
                <input pInputText id="shortcuts-help-search" type="search" class="mb-4 w-full outline-none!" placeholder="Search…" autocomplete="off" [ngModel]="query()" (ngModelChange)="query.set($event)" />
                <!-- Área rolável focável: quem usa só o teclado também consegue rolar a lista. -->
                <div class="flex max-h-[55vh] flex-col gap-4 overflow-auto pr-1" tabindex="0" role="region" aria-label="Shortcut list">
                    @for (group of groups(); track group.category) {
                        <section [attr.aria-labelledby]="'shortcuts-help-' + group.category">
                            <h2 [id]="'shortcuts-help-' + group.category" class="m-0 mb-1.5 text-sm font-semibold">{{ group.category }}</h2>
                            <dl class="m-0 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
                                @for (item of group.items; track item.id) {
                                    <dt class="text-muted-color">{{ item.label }}</dt>
                                    <dd class="m-0 flex flex-wrap justify-end gap-1.5">
                                        @for (chord of item.chords; track chord) {
                                            <kbd class="rounded border border-surface-300 bg-surface-50 px-1.5 font-sans text-xs dark:border-surface-600 dark:bg-surface-800" aria-hidden="true">{{ keyboard.format(chord) }}</kbd>
                                            <span class="sr-only">{{ keyboard.spoken(chord) }}</span>
                                        }
                                    </dd>
                                }
                            </dl>
                        </section>
                    } @empty {
                        <p class="m-0 text-sm text-muted-color" role="status">No shortcuts match the search.</p>
                    }
                </div>
                <ng-template #footer>
                    <p-button label="Close" severity="secondary" [text]="true" (onClick)="close()" />
                    <p-button label="Customize…" icon="pi pi-key" (onClick)="customize()" />
                </ng-template>
            </p-dialog>
        }
    `,
    styles: `
        ::ng-deep {
            .shortcuts-dialog-custom {
                height: calc(100% - 56px) !important;
                top: 32px !important;
            }
        }
    `
})
export class ShortcutsDialog {
    protected readonly ui = inject(UiState);
    protected readonly keyboard = inject(KeybindingService);
    private readonly settingsDialog = inject(SettingsDialog);

    protected readonly query = signal('');

    protected readonly groups = computed(() => {
        const text = fold(this.query().trim());
        const bindings = this.keyboard.bindings();
        const items = COMMANDS.map((meta) => ({ id: meta.id, label: meta.label, category: meta.category, chords: bindings.get(meta.id) ?? [] })).filter(
            (item) => item.chords.length && (!text || fold(item.label).includes(text) || fold(item.category).includes(text) || item.chords.some((chord) => fold(this.keyboard.format(chord)).includes(text)))
        );

        return COMMAND_CATEGORIES.map((category) => ({ category, items: items.filter((item) => item.category === category) })).filter((group) => group.items.length);
    });

    protected close(): void {
        this.ui.shortcutsDialog.set(false);
        this.query.set('');
    }

    protected customize(): void {
        this.close();
        void this.settingsDialog.open('shortcuts');
    }
}
