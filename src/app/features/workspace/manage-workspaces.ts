import { Component, inject, signal, viewChild } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { DEFAULT_WORKSPACE_ID, type WorkspaceSummary } from '@shared/models';
import { MessageService, type MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MenuModule, type Menu } from 'primeng/menu';
import { MessageModule } from 'primeng/message';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { ConfirmState } from '../../core/state/confirm.state';
import { UiState } from '../../core/state/ui.state';
import { WorkspacesState } from '../../core/state/workspaces.state';
import { EnterSubmit } from '../../shared/enter-submit.directive';

/** Lista de workspaces com trocar, renomear, exportar, mostrar a pasta e remover da lista. */
@Component({
    selector: 'app-manage-workspaces',
    imports: [ReactiveFormsModule, ButtonModule, DialogModule, InputTextModule, MenuModule, MessageModule, EnterSubmit, FormsModule],
    template: `
        <div class="flex flex-col gap-4 p-4">
            <div class="flex flex-wrap items-center gap-2">
                <h2 class="m-0 mr-auto text-base font-semibold">Workspaces</h2>
                <p-button label="New Workspace" icon="pi pi-plus" size="small" (onClick)="ui.newWorkspaceDialog.set(true)" />
                <p-button label="Import Workspace" icon="pi pi-download" size="small" severity="secondary" [outlined]="true" (onClick)="ui.importWorkspaceDialog.set(true)" />
            </div>

            <table class="w-full table-fixed border-collapse text-sm">
                <caption class="sr-only">
                    Workspaces
                </caption>
                <thead>
                    <tr class="text-left text-xs text-muted-color">
                        <th scope="col" class="w-1/4 border-b border-surface-200 py-2 font-medium dark:border-surface-700">Name</th>
                        <th scope="col" class="border-b border-surface-200 py-2 font-medium dark:border-surface-700">Location</th>
                        <th scope="col" class="w-24 border-b border-surface-200 py-2 font-medium dark:border-surface-700">Collections</th>
                        <th scope="col" class="w-32 border-b border-surface-200 py-2 font-medium dark:border-surface-700"><span class="sr-only">Actions</span></th>
                    </tr>
                </thead>
                <tbody>
                    @for (workspace of workspaces.list(); track workspace.id) {
                        <tr>
                            <td class="border-b border-surface-100 py-2 pr-4 dark:border-surface-800">
                                <span class="flex min-w-0 items-center gap-2 font-medium">
                                    <span class="truncate" [title]="workspace.name">{{ workspace.name }}</span>
                                    @if (workspace.active) {
                                        <span class="shrink-0 rounded bg-primary-50 px-1.5 text-xs text-primary-700 dark:bg-primary-950 dark:text-primary-300">active</span>
                                    }
                                    @if (workspace.missing) {
                                        <span class="shrink-0 rounded bg-red-50 px-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">folder not found</span>
                                    }
                                </span>
                            </td>
                            <td class="border-b border-surface-100 py-2 pr-4 dark:border-surface-800">
                                <span class="block truncate font-mono text-xs text-muted-color" [title]="workspace.path ?? ''">{{ workspace.path ?? 'Stored only on this computer' }}</span>
                            </td>
                            <td class="border-b border-surface-100 py-2 dark:border-surface-800">{{ workspace.collectionCount }}</td>
                            <td class="border-b border-surface-100 py-2 dark:border-surface-800">
                                <span class="flex items-center justify-end gap-1">
                                    @if (!workspace.active) {
                                        <p-button label="Switch" size="small" severity="secondary" [text]="true" [ariaLabel]="'Switch to ' + workspace.name" (onClick)="open(workspace)" />
                                    } @else if (workspace.missing) {
                                        <p-button label="Fix" icon="pi pi-wrench" size="small" severity="danger" [text]="true" [ariaLabel]="'Fix missing folder of ' + workspace.name" (onClick)="open(workspace)" />
                                    }
                                    <button type="button" class="otto-icon-button" [attr.aria-label]="'More actions for ' + workspace.name" aria-haspopup="menu" (click)="showMenu($event, workspace)">
                                        <i class="pi pi-ellipsis-h" aria-hidden="true"></i>
                                    </button>
                                </span>
                            </td>
                        </tr>
                    }
                </tbody>
            </table>
            <p class="m-0 text-xs text-muted-color">Removing a workspace only takes it off this list. Its folder and collections stay on disk and can be opened again.</p>
        </div>

        <p-menu #rowMenu [model]="rowItems()" [popup]="true" appendTo="body" />

        <p-dialog closeAriaLabel="Close" header="Rename Workspace" [modal]="true" [visible]="!!renaming()" (visibleChange)="!$event && renaming.set(null)" [style]="{ width: '26rem' }" [draggable]="false" appendTo="body">
            <form appEnterSubmit (ngSubmit)="rename()" class="flex flex-col gap-2">
                <label for="rename-workspace" class="font-medium">Name</label>
                <input pInputText id="rename-workspace" [formControl]="nameControl" autocomplete="off" />
                @if (renameError(); as message) {
                    <p-message severity="error"
                        ><span role="alert">{{ message }}</span></p-message
                    >
                }
            </form>
            <ng-template #footer>
                <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="renaming.set(null)" />
                <p-button label="Rename" icon="pi pi-check" [disabled]="nameControl.invalid" (onClick)="rename()" />
            </ng-template>
        </p-dialog>
    `,
    host: { class: 'block' }
})
export class ManageWorkspaces {
    protected readonly workspaces = inject(WorkspacesState);
    protected readonly ui = inject(UiState);
    private readonly confirm = inject(ConfirmState);
    private readonly messages = inject(MessageService);
    private readonly rowMenu = viewChild.required<Menu>('rowMenu');

    protected readonly rowItems = signal<MenuItem[]>([]);
    protected readonly renaming = signal<WorkspaceSummary | null>(null);
    protected readonly renameError = signal<string | null>(null);
    protected readonly nameControl = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120), Validators.pattern(/^[^./\\][^/\\]*$/)] });

    constructor() {
        void this.workspaces.refreshList();
    }

    protected showMenu(event: MouseEvent, workspace: WorkspaceSummary): void {
        this.rowItems.set([
            { label: 'Rename', icon: 'pi pi-pencil', command: () => this.startRename(workspace) },
            { label: 'Export', icon: 'pi pi-upload', disabled: workspace.missing, command: () => void this.export(workspace) },
            { label: 'Show in Folder', icon: 'pi pi-external-link', disabled: !workspace.path || workspace.missing, command: () => void this.workspaces.reveal(workspace.id) },
            ...(workspace.missing ? [{ label: 'Recreate Folder', icon: 'pi pi-folder-plus', command: () => void this.recreate(workspace) }] : []),
            { separator: true },
            { label: 'Remove from List', icon: 'pi pi-trash', disabled: workspace.id === DEFAULT_WORKSPACE_ID, command: () => void this.remove(workspace) }
        ]);
        this.rowMenu().toggle(event);
    }

    /** Troca de workspace; com a pasta ausente, pergunta se remove ou recria. */
    protected async open(workspace: WorkspaceSummary): Promise<void> {
        try {
            await this.workspaces.open(workspace);
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not open the workspace', detail: ipcErrorMessage(error), life: 6000 });
        }
    }

    protected async rename(): Promise<void> {
        const workspace = this.renaming();

        if (!workspace || this.nameControl.invalid) {
            return;
        }

        try {
            await this.workspaces.rename(workspace.id, this.nameControl.value.trim());
            this.renaming.set(null);
        } catch (error) {
            this.renameError.set(ipcErrorMessage(error));
        }
    }

    private startRename(workspace: WorkspaceSummary): void {
        this.nameControl.setValue(workspace.name);
        this.renameError.set(null);
        this.renaming.set(workspace);
    }

    private async export(workspace: WorkspaceSummary): Promise<void> {
        try {
            const file = await this.workspaces.export(workspace);

            if (file) {
                this.messages.add({ severity: 'success', summary: 'Workspace exported', detail: file, life: 5000 });
            }
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not export the workspace', detail: ipcErrorMessage(error), life: 6000 });
        }
    }

    private async recreate(workspace: WorkspaceSummary): Promise<void> {
        try {
            await this.workspaces.recreate(workspace.id);
            this.messages.add({ severity: 'success', summary: 'Workspace folder recreated', detail: workspace.path ?? '', life: 5000 });
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not recreate the workspace folder', detail: ipcErrorMessage(error), life: 6000 });
        }
    }

    private async remove(workspace: WorkspaceSummary): Promise<void> {
        const accepted = await this.confirm.ask({
            header: 'Remove Workspace',
            message: `Remove "${workspace.name}" from the list? Its folder and collections are not deleted.`,
            acceptLabel: 'Remove',
            severity: 'danger'
        });

        if (accepted) {
            await this.workspaces.remove(workspace.id).catch((error: unknown) => this.messages.add({ severity: 'error', summary: 'Could not remove the workspace', detail: ipcErrorMessage(error), life: 6000 }));
        }
    }
}
