import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { ProgressBarModule } from 'primeng/progressbar';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { SettingsState } from '../../core/state/settings.state';
import { UpdatesState } from '../../core/state/updates.state';

const formatMb = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)} MB`;

/** Janela de atualização: notas da versão, download, instalação, "skip" e "remind me later". */
@Component({
    selector: 'app-update-dialog',
    imports: [DatePipe, FormsModule, DialogModule, ButtonModule, MessageModule, ProgressBarModule, ToggleSwitchModule],
    template: `
        <p-dialog closeAriaLabel="Close" [header]="header()" [modal]="true" [visible]="updates.dialogOpen()" (visibleChange)="!$event && updates.close()" [style]="{ width: '40rem', maxWidth: '95vw' }" [draggable]="false" appendTo="body">
            @if (updates.state(); as state) {
                <div class="flex flex-col gap-4">
                    <p class="m-0 text-sm text-muted-color">
                        Installed: <strong class="text-color">{{ state.currentVersion }}</strong>
                        · Channel: <strong class="text-color">{{ state.channel === 'beta' ? 'Beta (pre-releases only)' : 'Stable' }}</strong>
                    </p>

                    @switch (state.phase) {
                        @case ('checking') {
                            <p class="m-0 flex items-center gap-2" role="status"><i class="pi pi-spin pi-spinner" aria-hidden="true"></i> Checking for updates…</p>
                        }
                        @case ('error') {
                            <p-message severity="error" [text]="'Could not check for updates: ' + (state.error ?? 'unknown error')" />
                        }
                        @case ('idle') {
                            @if (state.mode === 'disabled') {
                                <p-message severity="info" text="Updates are disabled in development builds." />
                            }
                        }
                        @case ('not-available') {
                            <p class="m-0 flex items-center gap-2" role="status"><i class="pi pi-check-circle text-green-600 dark:text-green-400" aria-hidden="true"></i> You are on the latest version.</p>
                        }
                    }

                    @if (showRelease() && state.info; as info) {
                        <div class="flex flex-col gap-2">
                            <p class="m-0">
                                <strong>{{ info.version }}</strong>
                                @if (info.releaseDate) {
                                    <span class="text-sm text-muted-color"> · released {{ info.releaseDate | date: 'mediumDate' }}</span>
                                }
                            </p>
                            @if (info.releaseNotes) {
                                <div class="release-notes max-h-72 overflow-auto rounded-lg border border-surface-200 p-3 text-sm dark:border-surface-700" tabindex="0" aria-label="Release notes" [innerHTML]="info.releaseNotes"></div>
                            }
                        </div>
                    }

                    @if (state.phase === 'downloading' && state.progress; as progress) {
                        <div class="flex flex-col gap-1">
                            <p-progressbar [value]="roundedPercent()" aria-label="Download progress" />
                            <span class="text-xs text-muted-color" aria-live="polite">{{ progressLabel() }}</span>
                        </div>
                    }

                    @if (state.phase === 'available' && state.mode === 'notify-only') {
                        <p class="m-0 text-sm text-muted-color">This installation (deb package or macOS) cannot update itself. Download the new version from the release page.</p>
                    }

                    <div class="flex items-center gap-2 border-t border-surface-200 pt-3 dark:border-surface-700">
                        <p-toggleswitch inputId="update-auto-check" [ngModel]="autoCheck()" (ngModelChange)="setAutoCheck($event)" />
                        <label for="update-auto-check" class="text-sm">Check for updates automatically</label>
                    </div>
                </div>
            }
            <ng-template #footer>
                @switch (updates.state()?.phase) {
                    @case ('available') {
                        <p-button label="Skip This Version" severity="secondary" [text]="true" (onClick)="updates.skip()" />
                        <p-button label="Remind Me Later" severity="secondary" [text]="true" (onClick)="updates.remindLater()" />
                        @if (updates.state()?.mode === 'auto') {
                            <p-button label="Download" icon="pi pi-download" [autofocus]="true" (onClick)="updates.download()" />
                        } @else {
                            <p-button label="Open Release Page" icon="pi pi-external-link" [autofocus]="true" (onClick)="updates.openRelease()" />
                        }
                    }
                    @case ('downloading') {
                        <p-button label="Hide" severity="secondary" [text]="true" (onClick)="updates.close()" />
                    }
                    @case ('downloaded') {
                        <p-button label="Install on Next Launch" severity="secondary" [text]="true" (onClick)="updates.close()" />
                        <p-button label="Restart and Install" icon="pi pi-refresh" [autofocus]="true" (onClick)="updates.install()" />
                    }
                    @case ('error') {
                        <p-button label="Open Release Page" severity="secondary" [text]="true" (onClick)="updates.openRelease()" />
                        <p-button label="Retry" icon="pi pi-refresh" (onClick)="updates.check()" />
                    }
                    @default {
                        <p-button label="Close" severity="secondary" [text]="true" (onClick)="updates.close()" />
                        <p-button label="Check Now" icon="pi pi-refresh" [disabled]="updates.state()?.phase === 'checking' || updates.state()?.mode === 'disabled'" (onClick)="updates.check()" />
                    }
                }
            </ng-template>
        </p-dialog>
    `,
    styles: `
        .release-notes :is(h1, h2, h3) {
            margin: 0.5rem 0 0.25rem;
            font-size: 0.875rem;
            font-weight: 600;
        }
        .release-notes ul {
            margin: 0;
            padding-left: 1.25rem;
        }
    `
})
export class UpdateDialog {
    protected readonly updates = inject(UpdatesState);
    private readonly settings = inject(SettingsState);

    protected readonly autoCheck = computed(() => this.settings.settings().updates.autoCheck);
    protected readonly header = computed(() => {
        const state = this.updates.state();

        return state?.info && this.showRelease() ? `Update Available: ${state.info.version}` : 'Software Update';
    });
    protected readonly showRelease = computed(() => {
        const phase = this.updates.state()?.phase;

        return phase === 'available' || phase === 'downloading' || phase === 'downloaded';
    });
    protected readonly roundedPercent = computed(() => Math.round(this.updates.state()?.progress?.percent ?? 0));
    protected readonly progressLabel = computed(() => {
        const progress = this.updates.state()?.progress;

        return progress && progress.total ? `${formatMb(progress.transferred)} of ${formatMb(progress.total)} (${this.roundedPercent()}%)` : 'Starting download…';
    });

    protected setAutoCheck(autoCheck: boolean): void {
        void this.settings.update({ updates: { autoCheck } });
    }
}
