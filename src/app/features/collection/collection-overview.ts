import { Component, computed, inject, input } from '@angular/core';
import type { EntityId } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { CollectionsState } from '../../core/state/collections.state';
import { EnvironmentsState } from '../../core/state/environments.state';
import { UiState } from '../../core/state/ui.state';

/**
 * Visão geral da coleção (cartões de metadados + documentação). As demais abas
 * do padrão Bruno (Headers, Vars, Auth, Script...) chegam na Etapa 8.
 */
@Component({
    selector: 'app-collection-overview',
    imports: [ButtonModule],
    template: `
        @if (collection(); as current) {
            <div class="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <section aria-labelledby="collection-info-heading" class="flex flex-col gap-4">
                    <h2 id="collection-info-heading" class="sr-only">Collection information</h2>
                    <div class="grid gap-3 sm:grid-cols-2">
                        <div class="rounded-md border border-surface-200 p-3 dark:border-surface-700 sm:col-span-2">
                            <p class="m-0 flex items-center gap-2 text-xs font-medium text-muted-color"><i class="pi pi-folder" aria-hidden="true"></i>Location</p>
                            <p class="m-0 mt-1 break-all font-mono text-sm">{{ current.metadata.path }}</p>
                        </div>
                        <div class="rounded-md border border-surface-200 p-3 dark:border-surface-700">
                            <p class="m-0 flex items-center gap-2 text-xs font-medium text-muted-color"><i class="pi pi-send" aria-hidden="true"></i>Requests</p>
                            <p class="m-0 mt-1 text-2xl font-semibold">{{ requestCount() }}</p>
                        </div>
                        <div class="rounded-md border border-surface-200 p-3 dark:border-surface-700">
                            <p class="m-0 flex items-center gap-2 text-xs font-medium text-muted-color"><i class="pi pi-globe" aria-hidden="true"></i>Environments</p>
                            <p class="m-0 mt-1 text-2xl font-semibold">{{ environmentCount() }}</p>
                        </div>
                        <div class="rounded-md border border-surface-200 p-3 dark:border-surface-700">
                            <p class="m-0 flex items-center gap-2 text-xs font-medium text-muted-color"><i class="pi pi-tag" aria-hidden="true"></i>Format version</p>
                            <p class="m-0 mt-1 text-2xl font-semibold">{{ current.manifest.version }}</p>
                        </div>
                        <div class="rounded-md border border-surface-200 p-3 dark:border-surface-700">
                            <p class="m-0 flex items-center gap-2 text-xs font-medium text-muted-color"><i class="pi pi-sync" aria-hidden="true"></i>OpenAPI source</p>
                            <p class="m-0 mt-1 truncate text-sm">{{ current.metadata.source?.location ?? 'Not linked' }}</p>
                        </div>
                    </div>
                    <div class="flex gap-2">
                        <p-button label="New Request" icon="pi pi-plus" size="small" (onClick)="ui.newRequestDialog.set({ collectionId: current.metadata.id, folder: '' })" />
                        <p-button label="New Folder" icon="pi pi-folder-plus" size="small" severity="secondary" [outlined]="true" (onClick)="ui.newFolderDialog.set({ collectionId: current.metadata.id, folder: '' })" />
                    </div>
                </section>

                <aside aria-labelledby="collection-docs-heading" class="rounded-md border border-surface-200 dark:border-surface-700">
                    <h2 id="collection-docs-heading" class="m-0 flex items-center gap-2 border-b border-surface-200 px-3 py-2 text-sm font-semibold dark:border-surface-700"><i class="pi pi-file" aria-hidden="true"></i>Documentation</h2>
                    @if (current.manifest.description) {
                        <p class="m-0 whitespace-pre-wrap p-3 text-sm">{{ current.manifest.description }}</p>
                    } @else {
                        <p class="m-0 p-3 text-sm text-muted-color">No documentation yet. Add a <code>description</code> to <code>otto.yaml</code> to describe this collection.</p>
                    }
                </aside>
            </div>
        } @else {
            <p class="m-0 p-4 text-sm text-muted-color">This collection is not open.</p>
        }
    `,
    host: { class: 'block' }
})
export class CollectionOverview {
    readonly collectionId = input.required<EntityId>();

    protected readonly ui = inject(UiState);
    private readonly collections = inject(CollectionsState);
    private readonly environments = inject(EnvironmentsState);

    protected readonly collection = computed(() => this.collections.find(this.collectionId()));
    protected readonly requestCount = computed(() => (this.collection() ? this.collections.requestCount(this.collectionId()) : 0));
    protected readonly environmentCount = computed(() => this.environments.list(this.collectionId()).length);
}
