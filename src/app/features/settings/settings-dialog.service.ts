import { inject, Injectable, signal } from '@angular/core';
import { DialogService, type DynamicDialogConfig, type DynamicDialogRef } from 'primeng/dynamicdialog';
import type { PreferencesSection, SettingsPage } from './settings.page';

/** Configuração única da modal de Preferences (tamanho fixo, conteúdo sem padding e ocupando toda a área). */
const SETTINGS_DIALOG_CONFIG: DynamicDialogConfig = {
    header: 'Preferences',
    closeAriaLabel: 'Close preferences',
    style: { width: 'min(80rem, 86vw)', height: 'min(68rem, 76vh)' },
    contentStyle: { display: 'flex', flex: '1 1 auto', minHeight: '0', padding: '0', overflow: 'hidden' },
    breakpoints: { '640px': '100vw' },
    appendTo: '#main-content',
    maskStyleClass: 'settings-dialog-custom',
    keepInViewport: true,
    modal: true,
    closable: true,
    closeOnEscape: true,
    dismissableMask: true,
    maximizable: false,
    draggable: false,
    resizable: false,
    duplicate: false,
    focusTrap: true,
    focusOnShow: true,
    showHeader: true
};

/**
 * Ponto único de abertura da modal de Preferences (barra de status, menu nativo, atalhos...).
 * A página é carregada sob demanda e só existe uma instância aberta por vez.
 */
@Injectable({ providedIn: 'root' })
export class SettingsDialog {
    private readonly dialogs = inject(DialogService);
    private ref: DynamicDialogRef<SettingsPage> | null = null;

    /** Seção pedida na última abertura (objeto novo a cada pedido, para a página reagir mesmo se repetida). */
    readonly requestedSection = signal<{ section: PreferencesSection } | null>(null);

    /** Abre (ou, se já aberta, só troca de seção) a modal; `section` escolhe a seção inicial. */
    async open(section?: PreferencesSection): Promise<void> {
        if (section) {
            this.requestedSection.set({ section });
        }

        if (this.ref) {
            return;
        }

        const { SettingsPage } = await import('./settings.page');

        // Outra chamada pode ter aberto a modal enquanto o chunk carregava.
        if (this.ref) {
            return;
        }

        const ref = this.dialogs.open(SettingsPage, SETTINGS_DIALOG_CONFIG);

        if (ref) {
            this.ref = ref;
            ref.onClose.subscribe(() => {
                this.ref = null;
                this.requestedSection.set(null);
            });
        }
    }

    close(): void {
        this.ref?.close();
    }
}
