import { Component, computed, inject, input, signal } from '@angular/core';
import type { EntityId } from '@shared/models';
import { TabsModule } from 'primeng/tabs';
import { CollectionsState } from '../../core/state/collections.state';
import { CollectionKeyValues } from './collection-key-values';
import { ScopeAuth } from './scope-auth';
import { ScopeScripts } from './scope-scripts';

type Section = 'auth' | 'variables' | 'scripts';

/** Configurações de uma pasta (`_folder.yaml`): autenticação, variáveis e scripts herdados pelo que está dentro dela. */
@Component({
    selector: 'app-folder-settings',
    imports: [TabsModule, CollectionKeyValues, ScopeAuth, ScopeScripts],
    template: `
        @if (node(); as current) {
            <div class="px-4 pt-3">
                <h2 class="m-0 flex items-center gap-2 text-base font-semibold"><i class="pi pi-folder text-muted-color" aria-hidden="true"></i>{{ current.name }}</h2>
                <p class="m-0 mt-0.5 font-mono text-xs text-muted-color">{{ collectionName() }} / {{ current.path }}</p>
            </div>
            <p-tabs [value]="section()" (valueChange)="section.set($any($event))" class="px-4 pt-2">
                <p-tablist>
                    <p-tab value="auth"
                        >Auth
                        @if (current.settings.auth.type !== 'inherit') {
                            <span class="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" aria-hidden="true"></span><span class="sr-only">(configured)</span>
                        }
                    </p-tab>
                    <p-tab value="variables"
                        >Variables
                        @if (current.settings.variables.length) {
                            <span class="text-xs text-muted-color">({{ current.settings.variables.length }})</span>
                        }
                    </p-tab>
                    <p-tab value="scripts"
                        >Scripts
                        @if (current.settings.scripts.preRequest || current.settings.scripts.postResponse) {
                            <span class="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" aria-hidden="true"></span><span class="sr-only">(configured)</span>
                        }
                    </p-tab>
                </p-tablist>
                <p-tabpanels>
                    <p-tabpanel value="auth">
                        <app-scope-auth [collectionId]="collectionId()" [folder]="folder()" />
                    </p-tabpanel>
                    <p-tabpanel value="variables">
                        <app-collection-key-values [collectionId]="collectionId()" [folder]="folder()" field="variables" label="Folder variables" addLabel="Add Variable">
                            Saved in <code>{{ folder() }}/_folder.yaml</code> and used as <code>{{ variableExample }}</code> by the requests inside this folder (and its subfolders). They override collection variables and the variables of
                            the folders above; the selected environment overrides them. Use <code>{{ folderExample }}</code> to read only folder variables.
                        </app-collection-key-values>
                    </p-tabpanel>
                    <p-tabpanel value="scripts">
                        <app-scope-scripts [collectionId]="collectionId()" [folder]="folder()" />
                    </p-tabpanel>
                </p-tabpanels>
            </p-tabs>
        } @else {
            <p class="m-0 p-4 text-sm text-muted-color">This folder no longer exists in the collection.</p>
        }
    `,
    host: { class: 'block' }
})
export class FolderSettingsPage {
    readonly collectionId = input.required<EntityId>();
    readonly folder = input.required<string>();

    private readonly collections = inject(CollectionsState);

    protected readonly section = signal<Section>('auth');
    protected readonly variableExample = '{{$.name}}';
    protected readonly folderExample = '{{$folder.name}}';
    protected readonly node = computed(() => this.collections.findFolder(this.collectionId(), this.folder()));
    protected readonly collectionName = computed(() => this.collections.find(this.collectionId())?.manifest.name ?? '');
}
