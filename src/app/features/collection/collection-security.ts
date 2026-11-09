import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, linkedSignal, resource, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SCRIPT_PERMISSIONS, type EntityId, type ScriptInventoryEntry, type ScriptMode, type ScriptPermission, type ScriptPhaseName } from '@shared/models';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageModule } from 'primeng/message';
import { RadioButtonModule } from 'primeng/radiobutton';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { checkScript, scriptCapabilities, type ScriptCapability } from '../../core/scripting/script-policy';
import { DEFAULT_SANDBOX_LIMITS } from '../../core/scripting/script-sandbox';
import { scriptPermissionLabel, ScriptSecurityState, type ScriptActivityResult } from '../../core/scripting/script-security.state';
import { CollectionsGateway } from '../../core/ports';
import { CollectionsState } from '../../core/state/collections.state';
import { ConfirmState } from '../../core/state/confirm.state';
import { TabsState } from '../../core/state/tabs.state';
import { UiState } from '../../core/state/ui.state';
import { SecurityIcon, securityModeIcon } from '../../shared/security-icon';
import { ScriptChangesDialog } from './script-changes-dialog';

const MODES: ReadonlyArray<{ value: ScriptMode; label: string; description: string; icon: ReturnType<typeof securityModeIcon> }> = [
    { value: 'trusted', label: 'Trusted', description: 'Scripts run without asking. Edits you make in Otto stay trusted; changes from outside (a Git pull, another editor) ask first.', icon: securityModeIcon('trusted') },
    { value: 'ask', label: 'Ask before running', description: 'Before sending, Otto asks: allow once, allow for this session, or cancel the request.', icon: securityModeIcon('ask') },
    { value: 'disabled', label: 'Blocked', description: 'No script runs: requests are sent without them, and the console says they were skipped.', icon: securityModeIcon('disabled') }
];

const PERMISSION_HELP: Record<ScriptPermission, string> = {
    modifyRequest: 'otto.request.setHeader, setUrl, setBody… in pre-request scripts.',
    writeVariables: 'otto.environment.set/unset and otto.collectionVariables.set/unset.',
    writeCookies: 'otto.cookies.set, remove and clear.',
    sendRequests: "otto.request('…') may send the referenced request. Without it, only stored responses can be read.",
    readSecrets: 'Values of secret environment variables. Without it, scripts read them as ••••; requests still send the real value.'
};

const CAPABILITY_LABELS: Record<ScriptCapability, string> = {
    modifyRequest: 'changes the request',
    writeVariables: 'writes variables',
    writeCookies: 'changes cookies',
    sendRequests: 'uses other requests',
    readVariables: 'reads variables'
};

const PHASE_LABELS: Record<ScriptPhaseName, string> = { preRequest: 'Pre-request', postResponse: 'Post-response' };

const RESULT_LABELS: Record<ScriptActivityResult, string> = { ok: 'ok', error: 'error', stopped: 'stopped', blocked: 'blocked', skipped: 'skipped' };

const keyOf = (entry: Pick<ScriptInventoryEntry, 'location' | 'path' | 'phase'>): string => `${entry.location}:${entry.path}:${entry.phase}`;

/**
 * Aba Security da coleção: modo de segurança dos scripts, permissões, inventário de todos
 * os scripts (o que usam e o que mudou desde a confiança), limites do sandbox e atividade.
 */
@Component({
    selector: 'app-collection-security',
    imports: [DatePipe, FormsModule, ButtonModule, CheckboxModule, MessageModule, RadioButtonModule, ScriptChangesDialog, SecurityIcon],
    template: `
        <div class="flex max-w-5xl flex-col gap-6 pb-6">
            <section aria-labelledby="security-mode-heading" class="flex flex-col gap-3">
                <h2 id="security-mode-heading" class="m-0 text-base font-semibold">Script mode</h2>
                <p id="security-mode-help" class="m-0 text-sm text-muted-color">
                    The mode decides whether scripts run; the permissions below decide what they may do. Kept only on this computer, never in the collection files, so a collection from Git or a .zip cannot trust itself.
                </p>
                <div role="radiogroup" aria-labelledby="security-mode-heading" aria-describedby="security-mode-help" class="grid gap-2 md:grid-cols-3">
                    @for (option of modes; track option.value) {
                        <label
                            class="flex cursor-pointer gap-3 rounded-lg border p-3"
                            [class]="selectedMode() === option.value ? 'border-primary bg-primary-50 dark:bg-primary-950' : 'border-surface-200 dark:border-surface-700'"
                            [for]="'script-mode-' + option.value"
                        >
                            <p-radiobutton
                                name="script-mode"
                                [inputId]="'script-mode-' + option.value"
                                [value]="option.value"
                                [ngModel]="selectedMode()"
                                (ngModelChange)="changeMode($event)"
                                [disabled]="busy()"
                                [ariaLabelledBy]="'script-mode-' + option.value + '-label'"
                            />
                            <span class="flex flex-col gap-1">
                                <span [id]="'script-mode-' + option.value + '-label'" class="flex items-center gap-1.5 text-sm font-medium">
                                    <app-security-icon class="size-4" [class]="option.icon.tone" [kind]="option.icon.kind" />
                                    {{ option.label }}
                                </span>
                                <span class="text-xs text-muted-color">{{ option.description }}</span>
                            </span>
                        </label>
                    }
                </div>

                <div role="status">
                    @switch (status()) {
                        @case ('changed') {
                            <div class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                                <app-security-icon class="size-4" kind="ask" />
                                <span class="min-w-0 flex-1">{{ changedText() }}</span>
                                <p-button label="Review Changes" icon="pi pi-eye" size="small" severity="secondary" [outlined]="true" (onClick)="reviewOpen.set(true)" />
                                <p-button label="Trust Current Scripts" icon="pi pi-shield" size="small" [loading]="busy()" (onClick)="trustCurrent()" />
                            </div>
                        }
                        @case ('session') {
                            <div class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
                                <app-security-icon class="size-4" kind="trusted" />
                                <span class="min-w-0 flex-1">Allowed for this session: Otto asks again after a restart or if the scripts change.</span>
                                <p-button label="Ask Again" size="small" severity="secondary" [text]="true" (onClick)="security.forgetSession(collectionId())" />
                            </div>
                        }
                    }
                </div>
                @if (error(); as message) {
                    <p-message severity="error"
                        ><span role="alert">{{ message }}</span></p-message
                    >
                }
            </section>

            <section aria-labelledby="security-permissions-heading" class="flex flex-col gap-3">
                <div class="flex flex-wrap items-center gap-2">
                    <h2 id="security-permissions-heading" class="m-0 text-base font-semibold">Permissions</h2>
                    <span class="text-xs text-muted-color">{{ policy()?.customPermissions ? 'Customized' : 'Default' }}</span>
                    @if (policy()?.customPermissions) {
                        <p-button class="ms-auto" label="Reset to Defaults" size="small" severity="secondary" [text]="true" [disabled]="busy()" (onClick)="resetPermissions()" />
                    }
                </div>
                <ul class="m-0 flex list-none flex-col gap-2 p-0">
                    @for (permission of permissionKeys; track permission) {
                        <li class="flex items-start gap-3">
                            <p-checkbox
                                [inputId]="'script-permission-' + permission"
                                [binary]="true"
                                [ngModel]="policy()?.permissions?.[permission] ?? false"
                                (ngModelChange)="setPermission(permission, $event)"
                                [disabled]="busy() || mode() === 'disabled'"
                                [ariaLabelledBy]="'script-permission-' + permission + '-label'"
                            />
                            <span class="flex flex-col">
                                <label [id]="'script-permission-' + permission + '-label'" [for]="'script-permission-' + permission" class="text-sm font-medium">{{ label(permission) }}</label>
                                <span class="text-xs text-muted-color">{{ help[permission] }}</span>
                            </span>
                        </li>
                    }
                </ul>
            </section>

            <section aria-labelledby="security-inventory-heading" class="flex flex-col gap-3">
                <h2 id="security-inventory-heading" class="m-0 text-base font-semibold">Scripts in this collection ({{ rows().length }})</h2>
                @if (!inventory()) {
                    <p class="m-0 text-sm text-muted-color" role="status">Reading scripts…</p>
                } @else if (!rows().length && !removed().length) {
                    <p class="m-0 text-sm text-muted-color">This collection has no scripts.</p>
                } @else {
                    <div class="overflow-x-auto rounded-lg border border-surface-200 dark:border-surface-700">
                        <table class="w-full border-collapse text-sm">
                            <caption class="sr-only">
                                Scripts of the collection, what they use and whether they changed since they were trusted
                            </caption>
                            <thead class="bg-surface-50 text-left text-xs text-muted-color dark:bg-surface-900">
                                <tr>
                                    <th scope="col" class="px-3 py-2 font-medium">Where</th>
                                    <th scope="col" class="px-3 py-2 font-medium">Phase</th>
                                    <th scope="col" class="px-3 py-2 font-medium">Uses</th>
                                    <th scope="col" class="px-3 py-2 text-right font-medium">Lines</th>
                                    <th scope="col" class="px-3 py-2 font-medium">Status</th>
                                    <th scope="col" class="px-3 py-2"><span class="sr-only">Actions</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                @for (row of rows(); track row.key) {
                                    <tr class="border-t border-surface-200 dark:border-surface-700">
                                        <td class="px-3 py-2">
                                            <span class="flex items-center gap-2">
                                                <i class="pi text-xs text-muted-color" [class]="row.icon" aria-hidden="true"></i>
                                                <span>{{ row.name }}</span>
                                                @if (row.location !== 'collection') {
                                                    <span class="truncate font-mono text-xs text-muted-color">{{ row.path }}</span>
                                                }
                                            </span>
                                        </td>
                                        <td class="px-3 py-2">{{ row.phase }}</td>
                                        <td class="px-3 py-2">
                                            {{ row.uses || '—' }}
                                            @if (row.warnings) {
                                                <span class="block text-xs text-amber-800 dark:text-amber-300">{{ row.warnings }} unavailable API{{ row.warnings === 1 ? '' : 's' }}</span>
                                            }
                                        </td>
                                        <td class="px-3 py-2 text-right tabular-nums">{{ row.lines }}</td>
                                        <td class="px-3 py-2">
                                            <span class="rounded-full px-1.5 text-xs font-medium" [class]="trustClass(row.trust)">{{ trustLabel(row.trust) }}</span>
                                        </td>
                                        <td class="px-3 py-2 text-right">
                                            <p-button label="Open" size="small" severity="secondary" [text]="true" [ariaLabel]="'Open ' + row.name + ' ' + row.phase + ' script'" (onClick)="open(row)" />
                                        </td>
                                    </tr>
                                }
                                @for (row of removed(); track row.key) {
                                    <tr class="border-t border-surface-200 text-muted-color dark:border-surface-700">
                                        <td class="px-3 py-2 line-through">{{ row.name }}</td>
                                        <td class="px-3 py-2">{{ row.phase }}</td>
                                        <td class="px-3 py-2">—</td>
                                        <td class="px-3 py-2"></td>
                                        <td class="px-3 py-2"><span class="rounded-full bg-red-100 px-1.5 text-xs font-medium text-red-900 dark:bg-red-950 dark:text-red-200">removed</span></td>
                                        <td class="px-3 py-2"></td>
                                    </tr>
                                }
                            </tbody>
                        </table>
                    </div>
                    <p class="m-0 text-xs text-muted-color">"Uses" is detected by reading the code and may miss indirect calls; the permissions above are enforced while the script runs.</p>
                }
            </section>

            <section aria-labelledby="security-sandbox-heading" class="flex flex-col gap-2">
                <h2 id="security-sandbox-heading" class="m-0 text-base font-semibold">Sandbox</h2>
                <p class="m-0 text-sm text-muted-color">
                    Each script runs in its own QuickJS (WebAssembly) sandbox, in a background worker, so a slow script never freezes Otto. It only sees <code>otto</code> and <code>console</code>: no <code>fetch</code>, files, DOM or timers (use
                    <code>await otto.sleep(ms)</code>). What it can change (the request, variables, cookies, other requests) is set by the permissions above. A script that goes over a limit is stopped; if it is a pre-request script, its request is
                    not sent.
                </p>
                <dl class="m-0 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    @for (limit of limits; track limit.label) {
                        <div class="rounded-lg border border-surface-200 p-3 dark:border-surface-700">
                            <dt class="text-xs text-muted-color">{{ limit.label }}</dt>
                            <dd class="m-0 font-medium tabular-nums">{{ limit.value }}</dd>
                            <dd class="m-0 mt-1 text-xs text-muted-color">{{ limit.hint }}</dd>
                        </div>
                    }
                </dl>
            </section>

            <section aria-labelledby="security-activity-heading" class="flex flex-col gap-2">
                <h2 id="security-activity-heading" class="m-0 text-base font-semibold">Recent activity</h2>
                @if (activity().length) {
                    <div class="overflow-x-auto rounded-lg border border-surface-200 dark:border-surface-700">
                        <table class="w-full border-collapse text-sm">
                            <caption class="sr-only">
                                Scripts run in this session, most recent first
                            </caption>
                            <thead class="bg-surface-50 text-left text-xs text-muted-color dark:bg-surface-900">
                                <tr>
                                    <th scope="col" class="px-3 py-2 font-medium">Time</th>
                                    <th scope="col" class="px-3 py-2 font-medium">Request</th>
                                    <th scope="col" class="px-3 py-2 font-medium">Script</th>
                                    <th scope="col" class="px-3 py-2 text-right font-medium">Duration</th>
                                    <th scope="col" class="px-3 py-2 font-medium">Result</th>
                                </tr>
                            </thead>
                            <tbody>
                                @for (item of activity(); track item.id) {
                                    <tr class="border-t border-surface-200 align-top dark:border-surface-700">
                                        <td class="whitespace-nowrap px-3 py-2 tabular-nums">{{ item.at | date: 'HH:mm:ss' }}</td>
                                        <td class="px-3 py-2">{{ item.requestName }}</td>
                                        <td class="px-3 py-2">{{ phaseLabel(item.phase) }}{{ item.origin ? ' · ' + item.origin : '' }}</td>
                                        <td class="px-3 py-2 text-right tabular-nums">{{ item.durationMs === null ? '—' : item.durationMs + ' ms' }}</td>
                                        <td class="px-3 py-2">
                                            <span class="rounded-full px-1.5 text-xs font-medium" [class]="resultClass(item.result)">{{ resultLabel(item.result) }}</span>
                                            @if (item.message && item.result !== 'ok') {
                                                <span class="mt-1 block text-xs text-muted-color">{{ item.message }}</span>
                                            }
                                        </td>
                                    </tr>
                                }
                            </tbody>
                        </table>
                    </div>
                } @else {
                    <p class="m-0 text-sm text-muted-color">No script has run in this session yet.</p>
                }
            </section>
        </div>

        <app-script-changes-dialog [collectionId]="collectionId()" [(visible)]="reviewOpen" />
    `,
    host: { class: 'block' }
})
export class CollectionSecurity {
    readonly collectionId = input.required<EntityId>();

    protected readonly security = inject(ScriptSecurityState);
    private readonly collections = inject(CollectionsState);
    private readonly gateway = inject(CollectionsGateway);
    private readonly confirm = inject(ConfirmState);
    private readonly tabs = inject(TabsState);
    private readonly ui = inject(UiState);

    protected readonly modes = MODES;
    protected readonly permissionKeys = SCRIPT_PERMISSIONS;
    protected readonly help = PERMISSION_HELP;
    protected readonly limits = [
        { label: 'Memory', value: `${DEFAULT_SANDBOX_LIMITS.memoryBytes / 1024 / 1024} MB`, hint: 'Per script run' },
        { label: 'Continuous work', value: `${DEFAULT_SANDBOX_LIMITS.sliceMs / 1000} s`, hint: 'Longest stretch of code without an await' },
        { label: 'CPU time', value: `${DEFAULT_SANDBOX_LIMITS.cpuMs / 1000} s`, hint: 'Total computing time of one script' },
        { label: 'Total time', value: `${DEFAULT_SANDBOX_LIMITS.wallMs / 1000} s`, hint: 'Includes waiting for otto.sleep and other requests' },
        { label: 'Call stack', value: `${DEFAULT_SANDBOX_LIMITS.stackBytes / 1024 / 1024} MB`, hint: 'Limits deep recursion' }
    ];

    protected readonly busy = signal(false);
    protected readonly error = signal<string | null>(null);
    protected readonly reviewOpen = signal(false);

    protected readonly policy = computed(() => this.security.policy(this.collectionId()));
    protected readonly mode = computed(() => this.policy()?.mode ?? 'ask');
    /** Rádio selecionado: segue o modo salvo e volta a ele se a confirmação for cancelada. */
    protected readonly selectedMode = linkedSignal(() => this.mode());
    protected readonly inventory = computed(() => this.security.inventory(this.collectionId()));
    protected readonly status = computed(() => this.security.status(this.collectionId()));
    protected readonly activity = computed(() => this.security.activity(this.collectionId()));

    /** Código atual (para o que cada script usa); relido quando a impressão digital muda. */
    private readonly sources = resource({
        params: () => ({ id: this.collectionId(), fingerprint: this.inventory()?.fingerprint }),
        loader: ({ params }) => this.gateway.scriptSources(params.id)
    });

    protected readonly rows = computed(() => {
        const code = new Map((this.sources.value()?.current ?? []).map((script) => [keyOf(script), script.code]));

        return (this.inventory()?.entries ?? []).map((entry) => {
            const source = code.get(keyOf(entry)) ?? '';

            return {
                ...entry,
                key: keyOf(entry),
                phase: PHASE_LABELS[entry.phase],
                phaseName: entry.phase,
                icon: entry.location === 'collection' ? 'pi-box' : entry.location === 'folder' ? 'pi-folder' : 'pi-send',
                uses: [...scriptCapabilities(source)].map((capability) => CAPABILITY_LABELS[capability]).join(', '),
                warnings: checkScript(source).length
            };
        });
    });
    protected readonly removed = computed(() => (this.inventory()?.removed ?? []).map((entry) => ({ key: keyOf(entry), name: entry.name, phase: PHASE_LABELS[entry.phase] })));

    protected readonly changedText = computed(() => {
        const policy = this.policy();
        const changes = this.security.changes(this.collectionId());
        const since = policy?.trustedAt ? ` on ${new Date(policy.trustedAt).toLocaleString()}` : '';

        return `${changes} script${changes === 1 ? '' : 's'} changed outside Otto since you trusted them${since}. Otto asks before running them.`;
    });

    constructor() {
        effect(() => {
            const id = this.collectionId();

            untracked(() => this.security.ensure(id));
        });
    }

    protected label(permission: ScriptPermission): string {
        return scriptPermissionLabel(permission);
    }

    protected phaseLabel(phase: ScriptPhaseName): string {
        return PHASE_LABELS[phase];
    }

    protected resultLabel(result: ScriptActivityResult): string {
        return RESULT_LABELS[result];
    }

    protected trustLabel(trust: ScriptInventoryEntry['trust']): string {
        return this.mode() !== 'trusted' ? 'not trusted' : trust === 'same' ? 'trusted' : trust;
    }

    protected trustClass(trust: ScriptInventoryEntry['trust']): string {
        if (this.mode() !== 'trusted') {
            return 'bg-surface-100 text-surface-800 dark:bg-surface-800 dark:text-surface-200';
        }

        return trust === 'same'
            ? 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200'
            : trust === 'new'
              ? 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200'
              : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200';
    }

    protected resultClass(result: ScriptActivityResult): string {
        switch (result) {
            case 'ok':
                return 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200';
            case 'skipped':
                return 'bg-surface-100 text-surface-800 dark:bg-surface-800 dark:text-surface-200';
            case 'error':
                return 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200';
            default:
                return 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200';
        }
    }

    protected async changeMode(mode: ScriptMode): Promise<void> {
        const policy = this.policy();

        if (!policy || mode === policy.mode) {
            return;
        }

        this.selectedMode.set(mode);

        if (mode === 'trusted' && !(await this.confirmTrust())) {
            this.selectedMode.set(policy.mode);

            return;
        }

        await this.save(() => this.security.setPolicy(this.collectionId(), { mode, permissions: policy.customPermissions ? policy.permissions : null }));
        // Se a gravação falhou, o rádio volta para o modo salvo.
        this.selectedMode.set(this.mode());
    }

    protected setPermission(permission: ScriptPermission, value: boolean): Promise<void> {
        const policy = this.policy();

        return policy ? this.save(() => this.security.setPolicy(this.collectionId(), { mode: policy.mode, permissions: { ...policy.permissions, [permission]: value } })) : Promise.resolve();
    }

    protected resetPermissions(): Promise<void> {
        return this.save(() => this.security.setPolicy(this.collectionId(), { mode: this.mode(), permissions: null }));
    }

    protected trustCurrent(): Promise<void> {
        return this.save(() => this.security.trustCurrent(this.collectionId()));
    }

    protected open(row: { location: string; path: string; name: string }): void {
        const collectionId = this.collectionId();

        if (row.location === 'collection') {
            this.ui.collectionSection.set({ collectionId, section: 'scripts' });
        } else if (row.location === 'folder') {
            this.tabs.open({ kind: 'folder', title: row.path.split('/').pop() ?? row.path, collectionId, resourceRef: row.path });
        } else {
            this.tabs.open({ kind: 'request', title: row.name, collectionId, resourceRef: row.path });
        }
    }

    /** Resumo do que os scripts fazem antes de confiar. */
    private confirmTrust(): Promise<boolean> {
        const rows = this.rows();
        const sending = rows.filter((row) => row.uses.includes(CAPABILITY_LABELS.sendRequests)).length;
        const writing = rows.filter((row) => row.uses.includes(CAPABILITY_LABELS.writeVariables)).length;
        const summary = rows.length ? `${rows.length} script${rows.length === 1 ? '' : 's'}${sending ? `, ${sending} using other requests` : ''}${writing ? `, ${writing} writing variables` : ''}.` : 'No scripts yet.';

        return this.confirm.ask({
            header: 'Trust This Collection?',
            message: `Scripts of "${this.collections.find(this.collectionId())?.manifest.name ?? 'this collection'}" will run without asking. ${summary}`,
            detail: 'The trust is tied to the current scripts: if any of them changes, Otto asks again and shows what changed.',
            acceptLabel: 'Trust',
            acceptIcon: 'pi pi-shield',
            severity: 'warn'
        });
    }

    private async save(action: () => Promise<void>): Promise<void> {
        this.busy.set(true);
        this.error.set(null);

        try {
            await action();
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        } finally {
            this.busy.set(false);
        }
    }
}
