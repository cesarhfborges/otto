import { Component, computed, effect, inject, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { EntityId } from '@shared/models';
import type { MenuItem } from 'primeng/api';
import { MenuModule } from 'primeng/menu';
import { SelectModule } from 'primeng/select';
import { TooltipModule } from 'primeng/tooltip';
import { CollectionsState } from '../core/state/collections.state';
import { EnvironmentsState } from '../core/state/environments.state';
import { TabsState } from '../core/state/tabs.state';
import { WorkspacesState } from '../core/state/workspaces.state';
import { UiState } from '../core/state/ui.state';

/**
 * Cabeçalho do contexto atual (acima das abas): workspace ou coleção. Na coleção
 * mostra o estado de sincronização OpenAPI e o seletor de ambiente.
 */
@Component({
    selector: 'app-context-header',
    imports: [MenuModule, SelectModule, TooltipModule, ReactiveFormsModule],
    template: `
        @if (collection(); as current) {
            <button type="button" class="otto-icon-button !w-auto gap-2 px-2 !text-color" aria-haspopup="menu" (click)="collectionMenu.toggle($event)">
                <i class="pi pi-box text-muted-color" aria-hidden="true"></i>
                <h1 class="m-0 truncate text-base font-semibold">{{ current.metadata.name }}</h1>
                <i class="pi pi-chevron-down text-xs text-muted-color" aria-hidden="true"></i>
            </button>
            <p-menu #collectionMenu [model]="collectionItems()" [popup]="true" appendTo="body" />

            <div class="ml-auto flex items-center gap-2">
                <!-- aria-disabled (e não disabled) mantém o foco e o tooltip acessíveis por teclado. -->
                <button type="button" class="otto-icon-button" aria-disabled="true" aria-label="Check for OpenAPI updates" [pTooltip]="syncTooltip()" tooltipPosition="bottom">
                    <i class="pi pi-sync" aria-hidden="true"></i>
                </button>
                <p-select [formControl]="environmentControl" [options]="environmentOptions()" optionLabel="label" optionValue="value" size="small" ariaLabel="Environment" placeholder="No Environment" class="w-48" appendTo="body">
                    <ng-template #selectedItem let-option>
                        <span class="flex items-center gap-2 text-sm"><i class="pi pi-globe text-xs" aria-hidden="true"></i>{{ option.label }}</span>
                    </ng-template>
                </p-select>
                <button type="button" class="otto-icon-button" aria-label="Manage environments" pTooltip="Manage environments" tooltipPosition="bottom" (click)="openEnvironments(current.metadata.id)">
                    <i class="pi pi-sliders-h" aria-hidden="true"></i>
                </button>
            </div>
        } @else {
            <i class="pi pi-th-large ml-2 text-muted-color" aria-hidden="true"></i>
            <h1 class="m-0 text-base font-semibold">{{ workspaces.activeName() }}</h1>
        }
    `,
    host: { class: 'flex h-11 shrink-0 items-center gap-2 px-2' }
})
export class ContextHeader {
    private readonly tabs = inject(TabsState);
    private readonly collections = inject(CollectionsState);
    protected readonly workspaces = inject(WorkspacesState);
    private readonly environments = inject(EnvironmentsState);
    private readonly ui = inject(UiState);

    protected readonly collection = computed(() => this.collections.find(this.tabs.context()));
    protected readonly environmentControl = new FormControl<EntityId | null>(null);

    protected readonly syncTooltip = computed(() => {
        const source = this.collection()?.metadata.source;

        return source ? `Linked to ${source.location}. Update checks are not available yet.` : 'Not linked to an OpenAPI spec. Import from OpenAPI to enable update checks.';
    });

    protected readonly environmentOptions = computed(() => {
        const id = this.tabs.context();
        const list = id ? this.environments.list(id) : [];

        return [{ label: 'No Environment', value: null }, ...list.map((env) => ({ label: env.name, value: env.id }))];
    });

    protected readonly collectionItems = computed<MenuItem[]>(() => {
        const id = this.tabs.context();

        if (!id) {
            return [];
        }

        return [
            { label: 'Overview', icon: 'pi pi-info-circle', command: () => this.tabs.open({ kind: 'collection', title: 'Overview', collectionId: id }) },
            { label: 'New Request', icon: 'pi pi-file-plus', command: () => this.ui.newRequestDialog.set({ collectionId: id, folder: '' }) },
            { label: 'New Folder', icon: 'pi pi-folder-plus', command: () => this.ui.newFolderDialog.set({ collectionId: id, folder: '' }) },
            { label: 'Environments', icon: 'pi pi-globe', command: () => this.openEnvironments(id) },
            { separator: true },
            {
                label: 'Remove from Workspace',
                icon: 'pi pi-times',
                command: () => {
                    this.tabs.closeCollection(id);
                    void this.collections.close(id);
                }
            }
        ];
    });

    protected openEnvironments(collectionId: EntityId): void {
        this.tabs.open({ kind: 'environments', title: 'Environments', collectionId });
    }

    constructor() {
        // Ao entrar numa coleção: carrega seus ambientes e reflete o ambiente selecionado.
        effect(() => {
            const id = this.tabs.context();

            untracked(() => {
                if (id) {
                    void this.environments.load(id);
                    this.environmentControl.setValue(this.environments.activeFor(id), { emitEvent: false });
                }
            });
        });

        this.environmentControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
            const id = this.tabs.context();

            if (id) {
                this.environments.select(id, value);
            }
        });
    }
}
