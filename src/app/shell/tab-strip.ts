import { LiveAnnouncer } from '@angular/cdk/a11y';
import { CdkDrag, type CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { afterNextRender, afterRenderEffect, ChangeDetectorRef, Component, computed, DestroyRef, ElementRef, inject, Injector, signal, viewChild } from '@angular/core';
import type { CollectionNode, HttpMethod, TabState } from '@shared/models';
import type { MenuItem } from 'primeng/api';
import { MenuModule, type Menu } from 'primeng/menu';
import { CollectionsState } from '../core/state/collections.state';
import { TabsState } from '../core/state/tabs.state';
import { UiState } from '../core/state/ui.state';
import { draftKey, RequestDraftsState } from '../core/state/request-drafts.state';
import { KeybindingService } from '../core/keyboard/keybinding.service';
import { SettingsDialog } from '../features/settings/settings-dialog.service';
import { MethodBadge } from '../shared/method-badge';
import { TAB_ICONS } from '../shared/tab-icon';

export const TAB_PANEL_ID = 'otto-tab-panel';

/** Largura mínima do thumb, para continuar fácil de agarrar com muitas abas. */
const MIN_THUMB_WIDTH = 32;
/** Quanto tempo a barra fica visível depois da última rolagem (ms). */
const SCROLL_HIDE_DELAY = 800;

/**
 * Abas do contexto atual. Padrão WAI-ARIA de tabs com foco itinerante:
 * setas/Home/End movem entre abas, Delete fecha. O "×" é atalho de mouse
 * (fora da ordem de tabulação) para não aninhar controles dentro da aba.
 * Arrastar reordena (CDK drag-drop); pelo teclado, os comandos `tabs.moveLeft`/`tabs.moveRight`.
 */
@Component({
    selector: 'app-tab-strip',
    imports: [CdkDropList, CdkDrag, MenuModule, MethodBadge],
    template: `
        <!-- O teclado (foco itinerante) é tratado no contêiner; o foco fica em cada role="tab". -->
        <!-- eslint-disable-next-line @angular-eslint/template/interactive-supports-focus -->
        <div
            #tablist
            role="tablist"
            aria-label="Open tabs"
            class="otto-tablist relative z-2 flex min-w-0 items-end gap-0.5 overflow-x-auto px-2 pt-[4px]"
            cdkDropList
            cdkDropListOrientation="horizontal"
            cdkDropListLockAxis="x"
            [cdkDropListAutoScrollStep]="12"
            (cdkDropListDropped)="onDrop($event)"
            (wheel)="onWheel($event)"
            (scroll)="onScroll()"
            (keydown)="onKeydown($event)"
        >
            @for (tab of tabs.visibleTabs(); track tab.id) {
                <!-- Os 4px de baixo (pb-1) são a faixa da barra de rolagem: o thumb nunca cobre o conteúdo da aba. -->
                <div
                    role="presentation"
                    class="otto-tab group relative flex h-[34px] max-w-60 pb-1 shrink-0 items-center rounded-t-md border border-b-0 text-sm"
                    cdkDrag
                    [cdkDragData]="tab"
                    (cdkDragStarted)="onDragStarted(tab)"
                    (cdkDragEnded)="onDragEnded()"
                    [class]="
                        tab.id === tabs.activeId()
                            ? 'z-2 border-surface-200 bg-surface-0 font-medium text-color dark:border-surface-700 dark:bg-surface-950'
                            : 'border-surface-100 after:absolute after:-inset-x-px after:bottom-0 after:h-px after:bg-surface-200 dark:border-surface-800 dark:after:bg-surface-700 bg-surface-50 text-muted-color hover:bg-surface-100 hover:text-color dark:bg-surface-900 dark:hover:bg-surface-800'
                    "
                    (auxclick)="$event.button === 1 && tabs.close(tab.id)"
                >
                    <button
                        type="button"
                        role="tab"
                        [id]="'tab-' + tab.id"
                        class="flex h-full min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent pl-3 pr-1 text-inherit"
                        [attr.aria-selected]="tab.id === tabs.activeId()"
                        [attr.aria-controls]="panelId"
                        [attr.aria-keyshortcuts]="keyShortcuts()"
                        [tabindex]="tab.id === tabs.activeId() ? 0 : -1"
                        (click)="tabs.activate(tab.id)"
                    >
                        @if (tab.kind === 'request') {
                            <app-method-badge [method]="methodOf(tab)" [compact]="true" class="!min-w-0" />
                        } @else {
                            <i [class]="icons[tab.kind]" class="text-xs" aria-hidden="true"></i>
                        }
                        <span class="truncate" [class.italic]="tab.kind === 'request' && !methodOf(tab)">{{ tab.title }}</span>
                        @if (isDirty(tab)) {
                            <span class="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true"></span>
                            <span class="sr-only">(unsaved changes)</span>
                        }
                    </button>
                    <span class="otto-icon-button mr-1 h-5! w-5! opacity-0 group-hover:opacity-100" [class.opacity-100]="tab.id === tabs.activeId()" aria-hidden="true" title="Close tab" (click)="tabs.close(tab.id)">
                        <i class="pi pi-times text-[0.625rem]"></i>
                    </span>
                </div>
            }
        </div>
        <!-- Barra de rolagem sobreposta à linha de base (a nativa fica oculta e não ocupa altura). Atalho de mouse:
             teclado, roda e scrollIntoView da aba ativa já cobrem a rolagem. -->
        @if (thumb(); as t) {
            <div
                class="otto-tab-scroll-thumb"
                [class.is-active]="scrolling() || dragging()"
                [class.is-dragging]="dragging()"
                [style.width.px]="t.width"
                [style.transform]="'translateX(' + t.left + 'px)'"
                aria-hidden="true"
                (pointerdown)="onThumbDown($event)"
                (pointermove)="onThumbMove($event)"
                (lostpointercapture)="onThumbRelease()"
            ></div>
        }
        <!-- Pílula tracejada ("espaço para nova aba"): no hover/foco expande e mostra o rótulo, que é o nome acessível.
             Alinhada pelo topo, no centro da linha das abas. -->
        <button type="button" class="otto-tab-add ml-2 mr-2 shrink-0 self-start" [attr.aria-haspopup]="tabs.context() ? null : 'menu'" (click)="add($event)">
            <i class="pi pi-plus" aria-hidden="true"></i>
            <span class="otto-tab-add-label">{{ addLabel() }}</span>
        </button>
        <p-menu #addMenu [model]="workspaceAddItems" [popup]="true" appendTo="body" />
    `,
    /*
     * A linha de base é um pseudo-elemento do host (e não border-b), visível entre as abas e ao lado do "+".
     * A máscara de fade faz do tablist um contexto de empilhamento, então ele inteiro (z-2) fica acima da linha:
     * a aba ativa, com o fundo do painel, a cobre e "abre" para o conteúdo; as inativas desenham a própria
     * linha num ::after que avança 1px sobre cada borda lateral (-inset-x-px), para a linha passar por cima
     * do canto, contínua com a do host. Nas bordas esmaecidas, a linha do host aparece por baixo.
     */
    host: { class: 'relative flex shrink-0 items-end after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-1 after:h-px after:bg-surface-200 dark:after:bg-surface-700' }
})
export class TabStrip {
    protected readonly tabs = inject(TabsState);
    private readonly collections = inject(CollectionsState);
    private readonly ui = inject(UiState);
    private readonly drafts = inject(RequestDraftsState);
    private readonly settingsDialog = inject(SettingsDialog);
    private readonly keyboard = inject(KeybindingService);
    private readonly announcer = inject(LiveAnnouncer);
    private readonly changeDetector = inject(ChangeDetectorRef);
    private readonly injector = inject(Injector);

    constructor() {
        // Aba ativada fora de vista (sidebar, paleta, restauração ao iniciar): rola a faixa só o necessário.
        afterRenderEffect(() => {
            const id = this.tabs.activeId();

            this.tabs.visibleTabs();

            if (id) {
                this.tablist().nativeElement.querySelector(`#tab-${CSS.escape(id)}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        });

        // Remede a barra quando a faixa ou alguma aba muda de largura (abrir/fechar, renomear, redimensionar a janela).
        afterRenderEffect(() => {
            this.tabs.visibleTabs();

            const list = this.tablist().nativeElement;

            this.resizeObserver ??= new ResizeObserver(() => this.measure());
            this.resizeObserver.disconnect();
            this.resizeObserver.observe(list);

            for (const child of Array.from(list.children)) {
                this.resizeObserver.observe(child);
            }
        });

        inject(DestroyRef).onDestroy(() => {
            this.resizeObserver?.disconnect();
            clearTimeout(this.scrollTimer);
        });
    }

    private resizeObserver?: ResizeObserver;
    private scrollTimer?: ReturnType<typeof setTimeout>;
    private thumbDrag: { x: number; scrollLeft: number } | null = null;
    private readonly metrics = signal({ scrollLeft: 0, scrollWidth: 0, clientWidth: 0, offsetLeft: 0 });
    /** Rolagem recente: mostra a barra mesmo sem hover (roda, arrasto de aba, aba ativada fora de vista). */
    protected readonly scrolling = signal(false);
    protected readonly dragging = signal(false);
    /** Largura e posição do thumb, relativas ao host; null sem transbordo. */
    protected readonly thumb = computed(() => {
        const { scrollLeft, scrollWidth, clientWidth, offsetLeft } = this.metrics();
        const range = scrollWidth - clientWidth;

        if (range <= 1) {
            return null;
        }

        const width = Math.max(MIN_THUMB_WIDTH, (clientWidth * clientWidth) / scrollWidth);

        return { width, left: offsetLeft + (scrollLeft / range) * (clientWidth - width) };
    });
    private readonly tablist = viewChild.required<ElementRef<HTMLElement>>('tablist');
    private readonly addMenu = viewChild.required<Menu>('addMenu');

    protected readonly panelId = TAB_PANEL_ID;
    protected readonly icons = TAB_ICONS;
    protected readonly addLabel = computed(() => (this.tabs.context() ? 'New request' : 'Open workspace tab'));
    /** Delete fecha; os atalhos de mover são a alternativa de teclado ao arrastar. */
    protected readonly keyShortcuts = computed(() => ['Delete', this.keyboard.aria('tabs.moveLeft'), this.keyboard.aria('tabs.moveRight')].filter(Boolean).join(' '));

    protected readonly workspaceAddItems: MenuItem[] = [
        { label: 'Overview', icon: 'pi pi-home', command: () => this.tabs.open({ kind: 'overview', title: 'Overview', collectionId: null }) },
        { label: 'Environments', icon: 'pi pi-globe', command: () => this.tabs.open({ kind: 'environments', title: 'Environments', collectionId: null }) },
        { label: 'Preferences', icon: 'pi pi-cog', command: () => void this.settingsDialog.open() }
    ];

    /** Método do rascunho em edição; sem rascunho, o da árvore (reflete edições feitas fora do app). */
    protected methodOf(tab: TabState): HttpMethod | null {
        const draft = tab.collectionId && tab.resourceRef ? this.drafts.draft(draftKey(tab.collectionId, tab.resourceRef)) : null;

        return draft?.method ?? findMethod(this.collections.find(tab.collectionId)?.tree.children ?? [], tab.resourceRef ?? '');
    }

    protected isDirty(tab: TabState): boolean {
        return tab.kind === 'request' && !!tab.collectionId && !!tab.resourceRef && this.drafts.isDirty(draftKey(tab.collectionId, tab.resourceRef));
    }

    protected add(event: MouseEvent): void {
        const context = this.tabs.context();

        if (context) {
            this.ui.newRequestDialog.set({ collectionId: context, folder: '' });
        } else {
            this.addMenu().toggle(event);
        }
    }

    protected onKeydown(event: KeyboardEvent): void {
        const visible = this.tabs.visibleTabs();
        const index = visible.findIndex((tab) => tab.id === this.tabs.activeId());
        let next: number | null = null;

        switch (event.key) {
            case 'ArrowRight':
                next = (index + 1) % visible.length;
                break;
            case 'ArrowLeft':
                next = (index - 1 + visible.length) % visible.length;
                break;
            case 'Home':
                next = 0;
                break;
            case 'End':
                next = visible.length - 1;
                break;
            case 'Delete':
                if (index >= 0) {
                    this.tabs.close(visible[index]!.id);
                    // O fechamento pode passar pelo guard (promessa): foca depois dele, como antes.
                    queueMicrotask(() => {
                        this.changeDetector.detectChanges();
                        this.focusActive();
                    });
                }

                event.preventDefault();

                return;
            default:
                this.keepFocusAfterGlobalShortcut();

                return;
        }

        event.preventDefault();
        this.tabs.activate(visible[next]!.id);
        this.changeDetector.detectChanges();
        this.focusActive();
    }

    /*
     * Ao soltar, o CDK faz tudo de forma síncrona: devolve a aba ao lugar de origem, emite `ended`,
     * zera os `transform` das vizinhas e emite `dropped`. Por isso a classe que liga a transição
     * (`otto-tabs-sorting`) é tirada direto no DOM em `ended`. Se dependesse da `cdk-drop-list-dragging`,
     * que só sai na próxima detecção de mudanças, as vizinhas voltariam deslizando por cima da nova
     * ordem: a faixa transbordaria por um instante e a barra de rolagem piscaria.
     */
    /**
     * Roda vertical do mouse rola a faixa na horizontal (como no VS Code e nos navegadores).
     * Gestos já horizontais (touchpad, Shift+roda) seguem o comportamento nativo; sem transbordo, nada muda.
     */
    protected onWheel(event: WheelEvent): void {
        const list = this.tablist().nativeElement;

        if (list.scrollWidth <= list.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || event.ctrlKey) {
            return;
        }

        // deltaMode 1 = linhas, 2 = páginas (alguns mouses no Linux/Windows); 0 = pixels.
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientWidth : 1;

        event.preventDefault();
        list.scrollLeft += event.deltaY * unit;
    }

    protected onScroll(): void {
        this.measure();
        this.scrolling.set(true);
        clearTimeout(this.scrollTimer);
        this.scrollTimer = setTimeout(() => this.scrolling.set(false), SCROLL_HIDE_DELAY);
    }

    protected onThumbDown(event: PointerEvent): void {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        this.thumbDrag = { x: event.clientX, scrollLeft: this.tablist().nativeElement.scrollLeft };
        this.dragging.set(true);
    }

    /** O thumb percorre (clientWidth - largura do thumb) enquanto o conteúdo percorre (scrollWidth - clientWidth). */
    protected onThumbMove(event: PointerEvent): void {
        const thumb = this.thumb();

        if (!this.thumbDrag || !thumb) {
            return;
        }

        const { scrollWidth, clientWidth } = this.metrics();
        const ratio = (scrollWidth - clientWidth) / Math.max(1, clientWidth - thumb.width);

        this.tablist().nativeElement.scrollLeft = this.thumbDrag.scrollLeft + (event.clientX - this.thumbDrag.x) * ratio;
    }

    /** `lostpointercapture` cobre soltar, cancelar e o thumb sumir no meio do arrasto. */
    protected onThumbRelease(): void {
        this.thumbDrag = null;
        this.dragging.set(false);
    }

    private measure(): void {
        const list = this.tablist().nativeElement;

        this.metrics.set({ scrollLeft: list.scrollLeft, scrollWidth: list.scrollWidth, clientWidth: list.clientWidth, offsetLeft: list.offsetLeft });
    }

    protected onDragStarted(tab: TabState): void {
        this.tabs.activate(tab.id);
        this.tablist().nativeElement.classList.add('otto-tabs-sorting');
    }

    protected onDragEnded(): void {
        this.tablist().nativeElement.classList.remove('otto-tabs-sorting');
    }

    protected onDrop(event: CdkDragDrop<unknown, unknown, TabState>): void {
        const tab = event.item.data;
        const moved = event.previousIndex !== event.currentIndex;

        if (moved) {
            this.tabs.moveTo(tab.id, event.currentIndex);
        }

        // Reordena o DOM já, no mesmo quadro em que o CDK zerou os transforms: sem um quadro com a ordem antiga.
        this.changeDetector.detectChanges();
        // Sem `preventScroll`, o foco rolaria a faixa; a rolagem fica onde o usuário soltou, só garantindo a aba visível.
        this.focusActive({ preventScroll: true })?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

        if (moved) {
            void this.announcer.announce(`${tab.title} moved to position ${event.currentIndex + 1} of ${this.tabs.visibleTabs().length}`);
        }
    }

    /**
     * Atalhos globais pressionados com o foco numa aba (mover, fechar...) reordenam ou removem
     * o elemento focado, e o foco cai no `<body>`. Se foi isso, ele volta para a aba ativa.
     */
    private keepFocusAfterGlobalShortcut(): void {
        const pressedAt = performance.now();

        afterNextRender(
            () => {
                if (document.activeElement === document.body && performance.now() - pressedAt < 1000) {
                    this.focusActive();
                }
            },
            { injector: this.injector }
        );
    }

    private focusActive(options?: FocusOptions): HTMLElement | null {
        const tab = this.tablist().nativeElement.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');

        tab?.focus(options);

        return tab;
    }
}

function findMethod(nodes: readonly CollectionNode[], path: string): HttpMethod | null {
    for (const node of nodes) {
        if (node.type === 'request' && node.path === path) {
            return node.method;
        }

        if (node.type === 'folder') {
            const found = findMethod(node.children, path);

            if (found) {
                return found;
            }
        }
    }

    return null;
}
