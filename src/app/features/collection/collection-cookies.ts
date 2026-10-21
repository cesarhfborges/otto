import { Component, computed, inject, input, signal } from '@angular/core';
import { isExpired, sameCookie, upsertCookie } from '@shared/http/cookie-jar';
import type { CollectionCookie, EntityId } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { CollectionsState } from '../../core/state/collections.state';
import { CookieDialog } from './cookie-dialog';

/** Cookies da coleção (`otto.yaml`): lista, cadastro/edição pela modal e remoção. */
@Component({
    selector: 'app-collection-cookies',
    imports: [ButtonModule, MessageModule, CookieDialog],
    template: `
        <p class="m-0 mb-3 max-w-3xl text-sm text-muted-color">
            Stored only in this collection and sent automatically to matching requests (unless the request sets its own <code>Cookie</code> header). <code>Set-Cookie</code> responses update this list. In templates, use
            <code>{{ commandExample }}</code> and friends (<code>set</code>, <code>remove</code>, <code>clear</code>, <code>header</code>).
        </p>
        <div class="overflow-x-auto">
            <table class="w-full min-w-[40rem] table-fixed border-collapse text-sm">
                <caption class="sr-only">
                    Collection cookies
                </caption>
                <thead>
                    <tr class="text-left text-xs text-muted-color">
                        <th scope="col" class="w-1/5 border-b border-surface-200 py-1.5 pr-2 font-medium dark:border-surface-700">Name</th>
                        <th scope="col" class="border-b border-surface-200 py-1.5 pr-2 font-medium dark:border-surface-700">Value</th>
                        <th scope="col" class="w-1/6 border-b border-surface-200 py-1.5 pr-2 font-medium dark:border-surface-700">Domain</th>
                        <th scope="col" class="w-20 border-b border-surface-200 py-1.5 pr-2 font-medium dark:border-surface-700">Path</th>
                        <th scope="col" class="w-44 border-b border-surface-200 py-1.5 pr-2 font-medium dark:border-surface-700">Expires</th>
                        <th scope="col" class="w-20 border-b border-surface-200 py-1.5 dark:border-surface-700"><span class="sr-only">Actions</span></th>
                    </tr>
                </thead>
                <tbody>
                    @for (cookie of cookies(); track $index) {
                        <tr [class.text-muted-color]="expired(cookie)">
                            <td class="truncate border-b border-surface-100 py-1 pr-2 font-mono dark:border-surface-800" [title]="cookie.name">{{ cookie.name }}</td>
                            <td class="truncate border-b border-surface-100 py-1 pr-2 font-mono dark:border-surface-800" [title]="cookie.value">{{ cookie.value }}</td>
                            <td class="truncate border-b border-surface-100 py-1 pr-2 dark:border-surface-800" [title]="cookie.domain || 'any'">{{ cookie.domain || 'any' }}</td>
                            <td class="truncate border-b border-surface-100 py-1 pr-2 dark:border-surface-800" [title]="cookie.path">{{ cookie.path }}</td>
                            <td class="truncate border-b border-surface-100 py-1 pr-2 dark:border-surface-800">{{ cookie.expires ? (expired(cookie) ? 'Expired' : formatDate(cookie.expires)) : 'Session' }}</td>
                            <td class="whitespace-nowrap border-b border-surface-100 py-1 text-right dark:border-surface-800">
                                <p-button icon="pi pi-pencil" size="small" severity="secondary" [text]="true" [ariaLabel]="'Edit cookie ' + cookie.name" (onClick)="edit(cookie)" />
                                <p-button icon="pi pi-trash" size="small" severity="secondary" [text]="true" [ariaLabel]="'Remove cookie ' + cookie.name" (onClick)="remove(cookie)" />
                            </td>
                        </tr>
                    } @empty {
                        <tr>
                            <td colspan="6" class="py-3 text-muted-color">No cookies yet.</td>
                        </tr>
                    }
                </tbody>
            </table>
        </div>
        @if (error(); as message) {
            <p-message severity="error" styleClass="mt-3"
                ><span role="alert">{{ message }}</span></p-message
            >
        }
        <div class="mt-3 flex items-center gap-2">
            <p-button label="Add Cookie" icon="pi pi-plus" size="small" severity="secondary" [text]="true" (onClick)="edit(null)" />
            @if (cookies().length) {
                <p-button label="Clear All" icon="pi pi-trash" size="small" severity="secondary" [text]="true" (onClick)="save([])" />
            }
        </div>
        <app-cookie-dialog [(visible)]="dialogOpen" [cookie]="editing()" (saved)="store($event)" />
    `,
    host: { class: 'block' }
})
export class CollectionCookies {
    readonly collectionId = input.required<EntityId>();

    private readonly collections = inject(CollectionsState);

    protected readonly commandExample = "{{ otto.cookies.get('session') }}";
    protected readonly cookies = computed<CollectionCookie[]>(() => this.collections.find(this.collectionId())?.manifest.cookies ?? []);
    protected readonly dialogOpen = signal(false);
    protected readonly editing = signal<CollectionCookie | null>(null);
    protected readonly error = signal<string | null>(null);
    protected readonly expired = (cookie: CollectionCookie): boolean => isExpired(cookie);
    protected readonly formatDate = (iso: string): string => new Date(iso).toLocaleString();

    protected edit(cookie: CollectionCookie | null): void {
        this.editing.set(cookie);
        this.dialogOpen.set(true);
    }

    protected store(cookie: CollectionCookie): void {
        const previous = this.editing();
        const rest = previous ? this.cookies().filter((item) => !sameCookie(item, previous)) : this.cookies();

        void this.save(upsertCookie(rest, cookie));
    }

    protected remove(cookie: CollectionCookie): void {
        void this.save(this.cookies().filter((item) => !sameCookie(item, cookie)));
    }

    protected async save(cookies: CollectionCookie[]): Promise<void> {
        this.error.set(null);

        try {
            await this.collections.updateManifest(this.collectionId(), { cookies });
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        }
    }
}
