import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import type { EntityId } from '@shared/models';
import type { MenuItem } from 'primeng/api';
import { TieredMenu, TieredMenuModule } from 'primeng/tieredmenu';
import { TooltipModule } from 'primeng/tooltip';
import { ScriptSecurityState, type ScriptSecurityStatus } from '../core/scripting/script-security.state';
import { CollectionsState } from '../core/state/collections.state';
import { ConfirmState } from '../core/state/confirm.state';
import { TabsState } from '../core/state/tabs.state';

interface StatusView {
    icon: string;
    /** Classes de cor (AA nos dois temas). */
    tone: string;
    text: string;
    describe: (collection: string) => string;
}

const VIEWS: Record<Exclude<ScriptSecurityStatus, 'none'>, StatusView> = {
    trusted: { icon: 'pi-shield', tone: 'text-green-700 dark:text-green-400', text: 'Scripts: trusted', describe: (name) => `Scripts of ${name} are trusted` },
    changed: { icon: 'pi-exclamation-triangle', tone: 'text-amber-800 dark:text-amber-300', text: 'Scripts changed', describe: (name) => `Scripts of ${name} changed since they were trusted: review them` },
    ask: { icon: 'pi-question-circle', tone: 'text-amber-800 dark:text-amber-300', text: 'Scripts: ask', describe: (name) => `Otto asks before running scripts of ${name}` },
    session: { icon: 'pi-clock', tone: 'text-blue-700 dark:text-blue-300', text: 'Scripts: allowed until restart', describe: (name) => `Scripts of ${name} are allowed until Otto restarts` },
    refused: { icon: 'pi-ban', tone: 'text-red-700 dark:text-red-400', text: 'Scripts: off', describe: (name) => `Scripts of ${name} were not allowed in this session` },
    disabled: { icon: 'pi-ban', tone: 'text-red-700 dark:text-red-400', text: 'Scripts: off', describe: (name) => `Scripts of ${name} are disabled` }
};

const PHASES = { preRequest: 'pre-request', postResponse: 'post-response' } as const;

/**
 * Estado de segurança dos scripts da coleção em uso (contexto das abas), na barra de
 * status. Some quando a coleção não tem scripts. Clique abre a aba Security; o menu de
 * contexto (botão direito, Shift+F10 ou a tecla Menu) tem as ações rápidas.
 */
@Component({
    selector: 'app-script-security-indicator',
    imports: [TieredMenuModule, TooltipModule],
    template: `
        @if (view(); as current) {
            <button
                type="button"
                class="ml-1 flex h-6 items-center gap-1.5 rounded px-2 text-xs hover:bg-surface-200 dark:hover:bg-surface-800"
                [attr.aria-label]="label()"
                aria-haspopup="menu"
                [pTooltip]="tooltip()"
                [tooltipDisabled]="menuOpen()"
                tooltipPosition="top"
                (click)="open()"
                (contextmenu)="showMenu($event)"
                (keydown.shift.f10)="showMenu($event)"
                (keydown.contextmenu)="showMenu($event)"
            >
                <span class="relative flex" aria-hidden="true">
                    @if (running()) {
                        <i class="pi pi-spin pi-spinner text-xs"></i>
                    } @else {
                        <i class="pi text-xs" [class]="current.icon + ' ' + current.tone"></i>
                    }
                    @if (problem()) {
                        <span class="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-red-600 dark:bg-red-400"></span>
                    }
                </span>
                <span class="hidden sm:inline">{{ text() }}</span>
            </button>
            <!-- Anexado ao próprio indicador: fica no landmark da barra de status (contentinfo), com posição absoluta. -->
            <p-tiered-menu #menu [model]="items()" [popup]="true" [appendTo]="host" (onShow)="menuOpen.set(true)" (onHide)="menuOpen.set(false)" />
        }
        <span class="sr-only" aria-live="polite">{{ announcement() }}</span>
    `,
    host: { class: 'contents' }
})
export class ScriptSecurityIndicator {
    private readonly security = inject(ScriptSecurityState);
    private readonly collections = inject(CollectionsState);
    private readonly tabs = inject(TabsState);
    private readonly confirm = inject(ConfirmState);
    private readonly menu = viewChild<TieredMenu>('menu');
    protected readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    /** O tooltip some enquanto o menu de ações está aberto (senão fica por cima dele). */
    protected readonly menuOpen = signal(false);

    private readonly collectionId = computed<EntityId | null>(() => this.tabs.context());
    private readonly status = computed(() => this.security.status(this.collectionId()));
    private readonly name = computed(() => this.collections.find(this.collectionId())?.manifest.name ?? 'this collection');

    protected readonly view = computed(() => {
        const status = this.status();

        return status === 'none' ? null : VIEWS[status];
    });
    protected readonly running = computed(() => {
        const running = this.security.running();

        return running && running.collectionId === this.collectionId() ? running : null;
    });
    protected readonly problem = computed(() => this.security.problem(this.collectionId()));

    protected readonly text = computed(() => {
        const running = this.running();
        const changes = this.security.changes(this.collectionId());

        if (running) {
            return `Running ${PHASES[running.phase]}…`;
        }

        return this.status() === 'changed' ? `Scripts changed (${changes})` : (this.view()?.text ?? '');
    });
    protected readonly label = computed(() => {
        const problem = this.problem();

        return `${this.view()?.describe(this.name()) ?? ''}.${problem ? ` Last script stopped: ${problem}.` : ''} Open security settings`;
    });
    protected readonly tooltip = computed(() => {
        const problem = this.problem();

        return `${this.view()?.describe(this.name()) ?? ''}${problem ? `\nLast script stopped: ${problem}` : ''}\nClick for security settings; right-click for quick actions.`;
    });
    /** Anuncia mudanças de estado e interrupções (não cada execução). */
    protected readonly announcement = computed(() => {
        const view = this.view();
        const problem = this.problem();

        return view ? `${view.describe(this.name())}.${problem ? ` A script was stopped: ${problem}` : ''}` : '';
    });

    protected readonly items = computed<MenuItem[]>(() => {
        const id = this.collectionId();
        const status = this.status();

        if (!id) {
            return [];
        }

        return [
            { label: 'Security Settings…', icon: 'pi pi-sliders-h', command: () => this.open() },
            { separator: true },
            ...(status === 'changed'
                ? [{ label: 'Trust Current Scripts', icon: 'pi pi-shield', command: () => void this.security.trustCurrent(id) }]
                : status !== 'trusted'
                  ? [{ label: 'Trust Collection…', icon: 'pi pi-shield', command: () => void this.trust(id) }]
                  : []),
            ...(this.security.policy(id)?.mode !== 'ask' ? [{ label: 'Ask Before Running', icon: 'pi pi-question-circle', command: () => void this.setMode(id, 'ask') }] : []),
            ...(status !== 'disabled' ? [{ label: 'Disable Scripts', icon: 'pi pi-ban', command: () => void this.setMode(id, 'disabled') }] : []),
            ...(this.security.sessionDecision(id) ? [{ label: 'Forget Session Decision', icon: 'pi pi-undo', command: () => this.security.forgetSession(id) }] : [])
        ];
    });

    constructor() {
        effect(() => {
            const id = this.collectionId();

            if (id) {
                untracked(() => this.security.ensure(id));
            }
        });
    }

    protected open(): void {
        const id = this.collectionId();

        if (id) {
            this.security.openSecurity(id);
        }
    }

    protected showMenu(event: Event): void {
        event.preventDefault();
        this.menu()?.toggle(event);
    }

    private async setMode(id: EntityId, mode: 'ask' | 'disabled'): Promise<void> {
        const policy = this.security.policy(id);

        await this.security.setPolicy(id, { mode, permissions: policy?.customPermissions ? policy.permissions : null });
    }

    private async trust(id: EntityId): Promise<void> {
        const count = this.security.inventory(id)?.entries.length ?? 0;
        const confirmed = await this.confirm.ask({
            header: 'Trust This Collection?',
            message: `The ${count} script${count === 1 ? '' : 's'} of "${this.name()}" will run without asking while they stay the same. Review them in the Security tab first if you don't know where this collection came from.`,
            acceptLabel: 'Trust',
            acceptIcon: 'pi pi-shield',
            severity: 'warn'
        });

        if (confirmed) {
            const policy = this.security.policy(id);

            await this.security.setPolicy(id, { mode: 'trusted', permissions: policy?.customPermissions ? policy.permissions : null });
        }
    }
}
