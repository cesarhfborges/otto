import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, model, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { AuthType, RequestAuth } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';

type AuthOption = { label: string; value: AuthType };

const OPTIONS: AuthOption[] = [
    { label: 'No Auth', value: 'none' },
    { label: 'Basic Auth', value: 'basic' },
    { label: 'Bearer Token', value: 'bearer' },
    { label: 'API Key', value: 'apikey' },
    { label: 'WSSE Auth', value: 'wsse' }
];

/** Autenticação da requisição. Os valores aceitam `{{variáveis}}`. */
import { OttoInput } from '../../shared/template-editor';
@Component({
    selector: 'app-auth-editor',
    imports: [NgTemplateOutlet, ReactiveFormsModule, SelectModule, ButtonModule, OttoInput],
    template: `
        <div class="flex max-w-xl flex-col gap-4">
            <div class="flex flex-col gap-2">
                <label for="auth-type" id="auth-type-label" class="text-sm font-medium">Type</label>
                <p-select inputId="auth-type" [formControl]="typeControl" [options]="options()" optionLabel="label" optionValue="value" size="small" class="w-full sm:w-64" appendTo="body" />
            </div>

            @switch (auth().type) {
                @case ('none') {
                    <p class="m-0 text-sm text-muted-color">No authentication is sent.</p>
                }
                @case ('inherit') {
                    <p class="m-0 text-sm text-muted-color">Uses the collection authentication (not configurable yet). Choose another type to set it here.</p>
                }
                @case ('basic') {
                    <ng-container *ngTemplateOutlet="credentials; context: { $implicit: 'basic' }" />
                    <small class="text-muted-color">Sent as <code>Authorization: Basic base64(username:password)</code>.</small>
                }
                @case ('wsse') {
                    <ng-container *ngTemplateOutlet="credentials; context: { $implicit: 'wsse' }" />
                    <small class="text-muted-color">WS-Security UsernameToken: a new nonce, timestamp and SHA-1 password digest are generated in the <code>X-WSSE</code> header on every send.</small>
                }
                @case ('bearer') {
                    <div class="flex flex-col gap-2">
                        <label for="auth-prefix" id="auth-prefix-label" class="text-sm font-medium">Prefix</label>
                        <app-otto-input inputId="auth-prefix" ariaLabelledBy="auth-prefix-label" class="font-mono !text-sm" [value]="field('prefix')" placeholder="Bearer" ariaDescribedBy="auth-prefix-help" (valueChange)="patch({ prefix: $event })" />
                        <small id="auth-prefix-help" class="text-muted-color">Optional. Leave blank to use <code>Bearer</code>.</small>
                    </div>
                    <div class="flex flex-col gap-2">
                        <label for="auth-token" id="auth-token-label" class="text-sm font-medium">Token</label>
                        <app-otto-input inputId="auth-token" ariaLabelledBy="auth-token-label" class="font-mono !text-sm" [value]="field('token')" [placeholder]="tokenPlaceholder" (valueChange)="patch({ token: $event })" />
                        <small class="text-muted-color">Sent as <code>Authorization: {{ bearerPrefix() }} &lt;token&gt;</code>.</small>
                    </div>
                }
                @case ('apikey') {
                    <div class="flex flex-col gap-2">
                        <label for="auth-key" id="auth-key-label" class="text-sm font-medium">Key</label>
                        <app-otto-input inputId="auth-key" ariaLabelledBy="auth-key-label" class="font-mono !text-sm" [value]="field('key')" placeholder="X-API-Key" (valueChange)="patch({ key: $event })" />
                    </div>
                    <div class="flex flex-col gap-2">
                        <label for="auth-value" id="auth-value-label" class="text-sm font-medium">Value</label>
                        <app-otto-input inputId="auth-value" ariaLabelledBy="auth-value-label" class="font-mono !text-sm" [value]="field('value')" (valueChange)="patch({ value: $event })" />
                    </div>
                    <div class="flex flex-col gap-2">
                        <label for="auth-in" id="auth-in-label" class="text-sm font-medium">Add to</label>
                        <select id="auth-in" class="otto-native-select w-full sm:w-64" [value]="field('in') || 'header'" (change)="patch({ in: $any($event.target).value })">
                            <option value="header">Header</option>
                            <option value="query">Query params</option>
                        </select>
                    </div>
                }
            }
        </div>

        <ng-template #credentials>
            <div class="flex flex-col gap-2">
                <label for="auth-username" id="auth-username-label" class="text-sm font-medium">Username</label>
                <app-otto-input inputId="auth-username" ariaLabelledBy="auth-username-label" class="!text-sm" [monospace]="false" [value]="field('username')" (valueChange)="patch({ username: $event })" />
            </div>
            <div class="flex flex-col gap-2">
                <label for="auth-password" id="auth-password-label" class="text-sm font-medium">Password</label>
                <div class="flex gap-2">
                    <app-otto-input inputId="auth-password" ariaLabelledBy="auth-password-label" class="min-w-0 flex-1 !text-sm" [type]="showPassword() ? 'text' : 'password'" [value]="field('password')" (valueChange)="patch({ password: $event })" />
                    <p-button [icon]="showPassword() ? 'pi pi-eye-slash' : 'pi pi-eye'" severity="secondary" [text]="true" size="small" [ariaLabel]="showPassword() ? 'Hide password' : 'Show password'" (onClick)="showPassword.set(!showPassword())" />
                </div>
            </div>
        </ng-template>
    `,
    host: { class: 'block' }
})
export class AuthEditor {
    readonly auth = model.required<RequestAuth>();

    protected readonly tokenPlaceholder = '{{$.token}}';
    protected readonly showPassword = signal(false);
    protected readonly typeControl = new FormControl<AuthType>('none', { nonNullable: true });
    /** "Inherit" só aparece para arquivos que já o usam (a auth da coleção ainda não existe). */
    protected readonly options = computed<AuthOption[]>(() => (this.auth().type === 'inherit' ? [...OPTIONS, { label: 'Inherit from Collection', value: 'inherit' }] : OPTIONS));

    protected readonly bearerPrefix = computed(() => this.field('prefix').trim() || 'Bearer');

    constructor() {
        effect(() => this.typeControl.setValue(this.auth().type, { emitEvent: false }));
        this.typeControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((type) => this.changeType(type));
    }

    protected field(name: string): string {
        return String((this.auth() as Record<string, unknown>)[name] ?? '');
    }

    protected patch(changes: Record<string, string>): void {
        this.auth.update((auth) => ({ ...auth, ...changes }) as RequestAuth);
    }

    /** Usuário/senha são aproveitados entre Basic e WSSE. */
    private changeType(type: AuthType): void {
        const current = this.auth();

        if (current.type === type) {
            return;
        }

        const username = 'username' in current ? current.username : '';
        const password = 'password' in current ? current.password : '';

        switch (type) {
            case 'none':
            case 'inherit':
                this.auth.set({ type });
                break;
            case 'basic':
            case 'wsse':
                this.auth.set({ type, username, password });
                break;
            case 'bearer':
                this.auth.set({ type, token: '' });
                break;
            case 'apikey':
                this.auth.set({ type, key: '', value: '', in: 'header' });
                break;
        }
    }
}
