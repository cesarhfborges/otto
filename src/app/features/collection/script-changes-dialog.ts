import { Component, computed, inject, input, model, resource, signal } from '@angular/core';
import type { CollectionScript, EntityId, ScriptPhaseName } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { ScriptSecurityState } from '../../core/scripting/script-security.state';
import { CollectionsGateway } from '../../core/ports';
import { LARGE_DIALOG_CONTENT, LARGE_DIALOG_STYLE } from '../../shared/dialog-size';
import { DiffView } from '../../shared/diff-view';
import { diffLines } from '../../shared/text-diff';

const PHASE_LABELS: Record<ScriptPhaseName, string> = { preRequest: 'Pre-request', postResponse: 'Post-response' };

const keyOf = (script: Pick<CollectionScript, 'location' | 'path' | 'phase'>): string => `${script.location}:${script.path}:${script.phase}`;

/** Scripts alterados, criados ou removidos desde a confiança, com o diff de cada um. */
@Component({
    selector: 'app-script-changes-dialog',
    imports: [DialogModule, ButtonModule, MessageModule, DiffView],
    template: `
        <p-dialog
            closeAriaLabel="Close"
            header="Script Changes Since Trusted"
            [modal]="true"
            [visible]="visible()"
            (visibleChange)="visible.set($event)"
            [style]="dialogStyle"
            [contentStyleClass]="dialogContent"
            [resizable]="false"
            [draggable]="false"
            appendTo="body"
        >
            <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto pr-1">
                @if (sources.error()) {
                    <p-message severity="error"
                        ><span role="alert">Could not read the scripts: {{ errorText() }}</span></p-message
                    >
                } @else if (sources.isLoading()) {
                    <p class="m-0 text-sm text-muted-color" role="status">Reading scripts…</p>
                } @else if (!changes().length) {
                    <p class="m-0 text-sm text-muted-color" role="status">The scripts are the same as when you trusted them.</p>
                } @else {
                    <p class="m-0 text-sm text-muted-color">{{ changes().length === 1 ? '1 script differs' : changes().length + ' scripts differ' }} from the trusted version. Lines in red were removed and lines in green were added.</p>
                    @for (change of changes(); track change.key) {
                        <section class="flex flex-col gap-2" [attr.aria-labelledby]="'script-change-' + $index">
                            <h3 [id]="'script-change-' + $index" class="m-0 flex flex-wrap items-center gap-2 text-sm font-semibold">
                                {{ change.title }}
                                <span class="rounded-full px-1.5 text-xs font-medium" [class]="badgeClass(change.kind)">{{ change.kind }}</span>
                            </h3>
                            <app-diff-view class="max-h-80" [lines]="change.lines" [label]="'Changes in ' + change.title" />
                        </section>
                    }
                }
            </div>
            <ng-template #footer>
                <p-button label="Close" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
                @if (changes().length) {
                    <p-button label="Trust Current Scripts" icon="pi pi-shield" [loading]="trusting()" (onClick)="trust()" />
                }
            </ng-template>
        </p-dialog>
    `
})
export class ScriptChangesDialog {
    readonly collectionId = input.required<EntityId>();
    readonly visible = model(false);

    private readonly gateway = inject(CollectionsGateway);
    private readonly security = inject(ScriptSecurityState);

    protected readonly dialogStyle = LARGE_DIALOG_STYLE;
    protected readonly dialogContent = LARGE_DIALOG_CONTENT;
    protected readonly trusting = signal(false);

    /** Relido a cada abertura e quando a impressão digital muda (git pull com o diálogo aberto). */
    protected readonly sources = resource({
        params: () => (this.visible() ? { id: this.collectionId(), fingerprint: this.security.inventory(this.collectionId())?.fingerprint } : undefined),
        loader: ({ params }) => this.gateway.scriptSources(params.id)
    });
    protected readonly errorText = computed(() => ipcErrorMessage(this.sources.error()));

    protected readonly changes = computed(() => {
        const inventory = this.security.inventory(this.collectionId());
        const sources = this.sources.value();

        if (!inventory || !sources) {
            return [];
        }

        const trusted = new Map(sources.trusted.map((script) => [keyOf(script), script.code]));
        const current = new Map(sources.current.map((script) => [keyOf(script), script.code]));
        const title = (name: string, phase: ScriptPhaseName, location: string) => `${location === 'collection' ? 'Collection' : name} · ${PHASE_LABELS[phase]}`;

        return [
            ...inventory.entries
                .filter((entry) => entry.trust !== 'same')
                .map((entry) => ({
                    key: keyOf(entry),
                    kind: entry.trust as 'changed' | 'new' | 'removed',
                    title: title(entry.name, entry.phase, entry.location),
                    lines: diffLines(trusted.get(keyOf(entry)) ?? '', current.get(keyOf(entry)) ?? '')
                })),
            ...inventory.removed.map((entry) => ({ key: keyOf(entry), kind: 'removed' as const, title: title(entry.name, entry.phase, entry.location), lines: diffLines(trusted.get(keyOf(entry)) ?? '', '') }))
        ];
    });

    protected badgeClass(kind: 'changed' | 'new' | 'removed'): string {
        return kind === 'new'
            ? 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200'
            : kind === 'removed'
              ? 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200'
              : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200';
    }

    protected async trust(): Promise<void> {
        this.trusting.set(true);

        try {
            await this.security.trustCurrent(this.collectionId());
            this.visible.set(false);
        } finally {
            this.trusting.set(false);
        }
    }
}
