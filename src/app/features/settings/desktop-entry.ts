import { Component, computed, inject, signal } from '@angular/core';
import type { DesktopEntryStatus } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { AppInfoGateway } from '../../core/ports';
import { ConfirmState } from '../../core/state/confirm.state';

/** Atalho no menu de aplicativos do Linux (AppImage ou `.deb`); some nas demais plataformas. */
@Component({
    selector: 'app-desktop-entry-settings',
    imports: [ButtonModule, MessageModule],
    template: `
        @if (status(); as s) {
            @if (s.state !== 'unsupported') {
                <section aria-labelledby="group-desktop-entry" class="flex flex-col gap-2">
                    <h3 id="group-desktop-entry" class="m-0 text-xs font-semibold uppercase tracking-wider text-muted-color">Desktop Integration</h3>
                    <div class="flex flex-col gap-3 rounded-lg border border-surface-200 p-4 dark:border-surface-700">
                        <div>
                            <span class="font-medium">Applications menu shortcut</span>
                            <p id="desktop-entry-help" class="m-0 mt-0.5 text-sm text-muted-color">
                                @if (s.mode === 'appimage') {
                                    AppImages are not integrated with the system. Add a launcher so Otto appears in the applications menu and the dock with its icon.
                                } @else {
                                    Launcher shown in the applications menu and the dock.
                                }
                            </p>
                        </div>

                        @switch (s.state) {
                            @case ('installed') {
                                <p-message severity="success" size="small" icon="pi pi-check-circle">
                                    <span role="status">The shortcut is installed at <code class="break-all">{{ s.path }}</code>.</span>
                                </p-message>
                            }
                            @case ('system') {
                                <p-message severity="success" size="small" icon="pi pi-check-circle">
                                    <span role="status">The shortcut was installed by the system package at <code class="break-all">{{ s.path }}</code>.</span>
                                </p-message>
                            }
                            @case ('invalid') {
                                <p-message severity="warn" size="small" icon="pi pi-exclamation-triangle">
                                    <div role="status" class="flex flex-col gap-1">
                                        <span>The shortcut at <code class="break-all">{{ s.path }}</code> needs to be fixed:</span>
                                        <ul class="m-0 list-disc pl-5">
                                            @for (issue of s.issues; track issue) {
                                                <li>{{ issue }}</li>
                                            }
                                        </ul>
                                    </div>
                                </p-message>
                            }
                            @case ('missing') {
                                <p class="m-0 text-sm" role="status">
                                    No shortcut found. It will be created at <code class="break-all">{{ s.path }}</code>.
                                </p>
                            }
                        }

                        @if (error(); as message) {
                            <p-message severity="error" size="small"><span role="alert">{{ message }}</span></p-message>
                        }

                        <div class="flex flex-wrap gap-2">
                            @switch (s.state) {
                                @case ('missing') {
                                    <p-button label="Create Shortcut" icon="pi pi-plus" [loading]="busy()" (onClick)="install()" />
                                }
                                @case ('invalid') {
                                    <p-button label="Fix Shortcut" icon="pi pi-wrench" [loading]="busy()" (onClick)="install()" />
                                }
                            }
                            @if (removable()) {
                                <p-button label="Remove Shortcut" icon="pi pi-trash" severity="secondary" [text]="true" [disabled]="busy()" (onClick)="remove()" />
                            }
                        </div>
                    </div>
                </section>
            }
        }
    `,
    host: { class: 'contents' }
})
export class DesktopEntrySettings {
    private readonly gateway = inject(AppInfoGateway);
    private readonly confirm = inject(ConfirmState);

    protected readonly status = signal<DesktopEntryStatus | null>(null);
    protected readonly busy = signal(false);
    protected readonly error = signal<string | null>(null);
    protected readonly removable = computed(() => {
        const state = this.status()?.state;

        return state === 'installed' || state === 'invalid';
    });

    constructor() {
        this.gateway.desktopEntry().then(
            (status) => this.status.set(status),
            () => undefined
        );
    }

    protected install(): Promise<void> {
        return this.run(() => this.gateway.installDesktopEntry());
    }

    protected async remove(): Promise<void> {
        const accepted = await this.confirm.ask({
            header: 'Remove Shortcut',
            message: `Remove ${this.status()?.path ?? 'the shortcut'}?`,
            detail: 'Otto will no longer appear in the applications menu. You can create the shortcut again at any time.',
            acceptLabel: 'Remove',
            acceptIcon: 'pi pi-trash',
            rejectLabel: 'Cancel'
        });

        if (accepted) {
            await this.run(() => this.gateway.removeDesktopEntry());
        }
    }

    private async run(action: () => Promise<DesktopEntryStatus>): Promise<void> {
        this.busy.set(true);
        this.error.set(null);

        try {
            this.status.set(await action());
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        } finally {
            this.busy.set(false);
        }
    }
}
