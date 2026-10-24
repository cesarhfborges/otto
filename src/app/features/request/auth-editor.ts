import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, input, model, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HAWK_ALGORITHMS, OAUTH1_SIGNATURE_METHODS, OAUTH2_GRANT_TYPES, type AuthType, type OAuth2GrantType, type RequestAuth } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { OttoInput, OttoTextarea } from '../../shared/template-editor';

type AuthOption = { label: string; value: AuthType };
type Choice = { label: string; value: string };

/** Mesma ordem dos outros clientes (Bruno/Postman); WSSE no fim. */
const OPTIONS: AuthOption[] = [
    { label: 'None', value: 'none' },
    { label: 'API Key', value: 'apikey' },
    { label: 'Basic', value: 'basic' },
    { label: 'Digest', value: 'digest' },
    { label: 'NTLM', value: 'ntlm' },
    { label: 'OAuth 1.0', value: 'oauth1' },
    { label: 'OAuth 2.0', value: 'oauth2' },
    { label: 'AWS IAM', value: 'awsv4' },
    { label: 'Bearer Token', value: 'bearer' },
    { label: 'Hawk', value: 'hawk' },
    { label: 'Atlassian ASAP', value: 'asap' },
    { label: 'Netrc', value: 'netrc' },
    { label: 'WSSE', value: 'wsse' }
];

const GRANT_LABELS: Record<OAuth2GrantType, string> = {
    authorization_code: 'Authorization Code',
    implicit: 'Implicit',
    client_credentials: 'Client Credentials',
    password: 'Password Credentials'
};

/** Autenticação da requisição. Os valores aceitam `{{variáveis}}`. */
@Component({
    selector: 'app-auth-editor',
    imports: [NgTemplateOutlet, ReactiveFormsModule, SelectModule, ButtonModule, OttoInput, OttoTextarea],
    templateUrl: './auth-editor.html',
    host: { class: 'block' }
})
export class AuthEditor {
    readonly auth = model.required<RequestAuth>();
    /** Oferece "Inherit" (requisições e pastas); a coleção, no topo, não herda de ninguém. */
    readonly allowInherit = input(true);
    /** O que `inherit` usaria agora: a autenticação e de onde vem (`null` = nada configurado acima). */
    readonly inherited = input<{ auth: RequestAuth; from: string } | null>(null);

    protected readonly tokenPlaceholder = '{{$.token}}';
    protected readonly signatureMethods: Choice[] = OAUTH1_SIGNATURE_METHODS.map((value) => ({ label: value, value }));
    protected readonly grantTypes: Choice[] = OAUTH2_GRANT_TYPES.map((value) => ({ label: GRANT_LABELS[value], value }));
    protected readonly hawkAlgorithms: Choice[] = HAWK_ALGORITHMS.map((value) => ({ label: value.toUpperCase(), value }));
    protected readonly addToOptions: Choice[] = [
        { label: 'Header', value: 'header' },
        { label: 'Query params', value: 'query' }
    ];
    protected readonly clientAuthOptions: Choice[] = [
        { label: 'Send as Basic Auth header', value: 'header' },
        { label: 'Send in the request body', value: 'body' }
    ];
    /** Campos secretos exibidos em texto puro. */
    private readonly revealed = signal<ReadonlySet<string>>(new Set());
    protected readonly typeControl = new FormControl<AuthType>('none', { nonNullable: true });
    protected readonly options = computed<AuthOption[]>(() => (this.allowInherit() ? [{ label: 'Inherit from parent', value: 'inherit' }, ...OPTIONS] : OPTIONS));
    /** Nome do tipo herdado, para a explicação do "Inherit". */
    protected readonly inheritedLabel = computed(() => {
        const inherited = this.inherited();

        return inherited ? (OPTIONS.find((option) => option.value === inherited.auth.type)?.label ?? inherited.auth.type) : null;
    });

    protected readonly bearerPrefix = computed(() => this.field('prefix').trim() || 'Bearer');
    protected readonly rsaSignature = computed(() => this.field('signatureMethod').startsWith('RSA-'));

    constructor() {
        effect(() => this.typeControl.setValue(this.auth().type, { emitEvent: false }));
        this.typeControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((type) => this.changeType(type));
    }

    protected field(name: string): string {
        return String((this.auth() as Record<string, unknown>)[name] ?? '');
    }

    protected flag(name: string): boolean {
        return (this.auth() as Record<string, unknown>)[name] === true;
    }

    protected isRevealed(name: string): boolean {
        return this.revealed().has(name);
    }

    protected toggleReveal(name: string): void {
        this.revealed.update((current) => {
            const next = new Set(current);

            next[next.has(name) ? 'delete' : 'add'](name);

            return next;
        });
    }

    protected setField(name: string, value: string): void {
        this.patch({ [name]: value });
    }

    protected patch(changes: Record<string, string | boolean>): void {
        this.auth.update((auth) => ({ ...auth, ...changes }) as RequestAuth);
    }

    /** Usuário/senha são aproveitados entre os tipos que os usam. */
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
            case 'netrc':
                this.auth.set({ type });
                break;
            case 'basic':
            case 'wsse':
            case 'digest':
                this.auth.set({ type, username, password });
                break;
            case 'ntlm':
                this.auth.set({ type, username, password, domain: '', workstation: '' });
                break;
            case 'bearer':
                this.auth.set({ type, token: '' });
                break;
            case 'apikey':
                this.auth.set({ type, key: '', value: '', in: 'header' });
                break;
            case 'oauth1':
                this.auth.set({ type, signatureMethod: 'HMAC-SHA1', consumerKey: '', consumerSecret: '', token: '', tokenSecret: '', privateKey: '', realm: '', addTo: 'header' });
                break;
            case 'oauth2':
                this.auth.set({
                    type,
                    grantType: 'authorization_code',
                    authUrl: '',
                    accessTokenUrl: '',
                    callbackUrl: '',
                    clientId: '',
                    clientSecret: '',
                    username,
                    password,
                    scope: '',
                    pkce: true,
                    clientAuth: 'header',
                    tokenPrefix: '',
                    addTo: 'header'
                });
                break;
            case 'awsv4':
                this.auth.set({ type, accessKeyId: '', secretAccessKey: '', sessionToken: '', region: '', service: '' });
                break;
            case 'hawk':
                this.auth.set({ type, id: '', key: '', algorithm: 'sha256', ext: '' });
                break;
            case 'asap':
                this.auth.set({ type, issuer: '', audience: '', subject: '', keyId: '', privateKey: '', expiresIn: '3600' });
                break;
        }
    }
}
