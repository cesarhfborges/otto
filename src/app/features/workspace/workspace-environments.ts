import { Component, computed, inject } from '@angular/core';
import { EnvironmentsState } from '../../core/state/environments.state';

/** Ambientes globais (compartilhados entre coleções). A edição chega com o editor de variáveis. */
@Component({
    selector: 'app-workspace-environments',
    template: `
        <div class="flex max-w-3xl flex-col gap-4 p-4">
            <h2 class="m-0 text-base font-semibold">Global Environments</h2>
            @if (environments().length) {
                <ul class="m-0 flex list-none flex-col gap-1 p-0">
                    @for (environment of environments(); track environment.id) {
                        <li class="flex items-center gap-3 rounded-md border border-surface-200 px-3 py-2 dark:border-surface-700">
                            <i class="pi pi-globe text-muted-color" aria-hidden="true"></i>
                            <span class="flex-1 text-sm font-medium">{{ environment.name }}</span>
                            <span class="text-xs text-muted-color">{{ environment.variables.length }} variables</span>
                        </li>
                    }
                </ul>
            } @else {
                <div class="flex flex-col items-center gap-2 rounded-md border border-dashed border-surface-300 p-8 text-center dark:border-surface-700">
                    <i class="pi pi-globe !text-3xl text-muted-color" aria-hidden="true"></i>
                    <p class="m-0 text-sm font-medium">No global environments</p>
                    <p class="m-0 max-w-md text-sm text-muted-color">
                        Global environments hold variables shared by every collection, like <code>{{ example }}</code
                        >. Creating and editing them arrives with the variables editor.
                    </p>
                </div>
            }
        </div>
    `,
    host: { class: 'block' }
})
export class WorkspaceEnvironments {
    private readonly state = inject(EnvironmentsState);

    protected readonly example = '{{token}}';
    protected readonly environments = computed(() => this.state.list(null));

    constructor() {
        void this.state.load(null);
    }
}
