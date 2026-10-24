import { Component, computed, effect, input, model, output, signal } from '@angular/core';
import { fromRawCookie, normalizeDomain, toRawCookie } from '@shared/http/cookie-jar';
import type { CollectionCookie } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { TabsModule } from 'primeng/tabs';
import { TextareaModule } from 'primeng/textarea';

const EMPTY: CollectionCookie = { name: '', value: '', domain: '', path: '/', expires: null, secure: false, httpOnly: false, hostOnly: false };

/** ISO → valor de `<input type="datetime-local">` (horário local). */
function toLocalInput(iso: string | null): string {
    if (!iso) {
        return '';
    }

    const date = new Date(iso);

    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** Cadastro/edição de um cookie da coleção (abas Friendly e Raw). */
@Component({
    selector: 'app-cookie-dialog',
    imports: [DialogModule, ButtonModule, InputTextModule, MessageModule, TabsModule, TextareaModule],
    template: `
        <p-dialog closeAriaLabel="Close" header="Manage Cookies" [modal]="true" [visible]="visible()" (visibleChange)="visible.set($event)" [style]="{ width: '46rem' }" [draggable]="false" appendTo="body">
            <p-tabs [value]="mode()" (valueChange)="switchMode($any($event))">
                <p-tablist>
                    <p-tab value="friendly">Friendly</p-tab>
                    <p-tab value="raw">Raw</p-tab>
                </p-tablist>
                <p-tabpanels class="!px-0">
                    <p-tabpanel value="friendly">
                        <div class="grid grid-cols-2 gap-x-3 gap-y-4">
                            <div class="flex flex-col gap-2">
                                <label for="cookie-name" class="font-medium">Key</label>
                                <input pInputText id="cookie-name" autocomplete="off" [value]="draft().name" (input)="patch({ name: $any($event.target).value })" />
                            </div>
                            <div class="flex flex-col gap-2">
                                <label for="cookie-value" class="font-medium">Value</label>
                                <input pInputText id="cookie-value" autocomplete="off" [value]="draft().value" (input)="patch({ value: $any($event.target).value })" />
                            </div>
                            <div class="flex flex-col gap-2">
                                <label for="cookie-domain" class="font-medium">Domain</label>
                                <input pInputText id="cookie-domain" autocomplete="off" placeholder="localhost" [value]="draft().domain" (input)="patch({ domain: $any($event.target).value })" />
                            </div>
                            <div class="flex flex-col gap-2">
                                <label for="cookie-path" class="font-medium">Path</label>
                                <input pInputText id="cookie-path" autocomplete="off" [value]="draft().path" (input)="patch({ path: $any($event.target).value })" />
                            </div>
                            <div class="col-span-2 flex flex-col gap-2">
                                <label for="cookie-expires" class="font-medium">Expires</label>
                                <input pInputText id="cookie-expires" type="datetime-local" aria-describedby="cookie-expires-help" [value]="expiresInput()" (input)="setExpires($any($event.target).value)" />
                                <small id="cookie-expires-help" class="text-muted-color">Empty: session cookie (never expires).</small>
                            </div>
                            <label class="flex items-center gap-2"><input type="checkbox" class="h-4 w-4 accent-[var(--p-primary-color)]" [checked]="draft().secure" (change)="patch({ secure: $any($event.target).checked })" /> Secure</label>
                            <label class="flex items-center gap-2"><input type="checkbox" class="h-4 w-4 accent-[var(--p-primary-color)]" [checked]="draft().httpOnly" (change)="patch({ httpOnly: $any($event.target).checked })" /> HttpOnly</label>
                            <label class="flex items-center gap-2"><input type="checkbox" class="h-4 w-4 accent-[var(--p-primary-color)]" [checked]="draft().hostOnly" (change)="patch({ hostOnly: $any($event.target).checked })" /> HostOnly</label>
                        </div>
                    </p-tabpanel>
                    <p-tabpanel value="raw">
                        <label for="cookie-raw" class="mb-2 block font-medium">Set-Cookie</label>
                        <textarea pTextarea id="cookie-raw" rows="4" class="w-full font-mono !text-sm" aria-describedby="cookie-raw-help" [value]="raw()" (input)="raw.set($any($event.target).value)"></textarea>
                        <small id="cookie-raw-help" class="text-muted-color">Example: <code>session=abc; Domain=localhost; Path=/; HttpOnly</code></small>
                    </p-tabpanel>
                </p-tabpanels>
            </p-tabs>
            @if (error(); as message) {
                <p-message severity="error" styleClass="mt-3"
                    ><span role="alert">{{ message }}</span></p-message
                >
            }
            <ng-template #footer>
                <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
                <p-button label="Done" icon="pi pi-check" (onClick)="done()" />
            </ng-template>
        </p-dialog>
    `
})
export class CookieDialog {
    readonly visible = model(false);
    /** Cookie em edição; `null` = novo. */
    readonly cookie = input<CollectionCookie | null>(null);
    readonly saved = output<CollectionCookie>();

    protected readonly mode = signal<'friendly' | 'raw'>('friendly');
    protected readonly draft = signal<CollectionCookie>(EMPTY);
    protected readonly raw = signal('');
    protected readonly error = signal<string | null>(null);
    protected readonly expiresInput = computed(() => toLocalInput(this.draft().expires));

    constructor() {
        // Reabre com o cookie escolhido (ou vazio).
        effect(() => {
            if (this.visible()) {
                this.draft.set({ ...(this.cookie() ?? EMPTY) });
                this.mode.set('friendly');
                this.error.set(null);
            }
        });
    }

    protected patch(change: Partial<CollectionCookie>): void {
        this.draft.update((cookie) => ({ ...cookie, ...change }));
    }

    protected setExpires(value: string): void {
        const date = new Date(value);

        this.patch({ expires: value && !Number.isNaN(date.getTime()) ? date.toISOString() : null });
    }

    protected switchMode(mode: 'friendly' | 'raw'): void {
        if (mode === 'raw') {
            this.raw.set(this.draft().name ? toRawCookie(this.draft()) : '');
        } else if (!this.syncRaw()) {
            return;
        }

        this.mode.set(mode);
    }

    /** Aplica a aba Raw no rascunho; `false` se inválida. */
    private syncRaw(): boolean {
        if (!this.raw().trim()) {
            return true;
        }

        const parsed = fromRawCookie(this.raw().trim(), this.draft().domain);

        if (!parsed) {
            this.error.set('Invalid cookie. Use name=value; Domain=…; Path=…');

            return false;
        }

        this.draft.set(parsed);
        this.error.set(null);

        return true;
    }

    protected done(): void {
        if (this.mode() === 'raw' && !this.syncRaw()) {
            return;
        }

        const cookie = { ...this.draft(), name: this.draft().name.trim(), domain: normalizeDomain(this.draft().domain), path: this.draft().path.trim() || '/' };

        if (!cookie.name) {
            this.error.set('Enter the cookie key.');

            return;
        }

        this.saved.emit(cookie);
        this.visible.set(false);
    }
}
