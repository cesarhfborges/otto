import { Component, computed, effect, inject, model, signal, untracked } from '@angular/core';
import { AVATAR_COLORS, AVATAR_ICONS, type AvatarColor, type AvatarIcon, type EntityId } from '@shared/models';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { CollectionsState } from '../../core/state/collections.state';
import { CollectionAvatar, collectionAccent, collectionInitials } from '../../shared/collection-avatar';

/** "money-bill" → "Money bill" (nome acessível dos botões de ícone). */
const iconLabel = (icon: string): string => icon.charAt(0).toUpperCase() + icon.slice(1).replace(/-/g, ' ');

/**
 * Personaliza o avatar da coleção: cor de fundo e/ou ícone no lugar das iniciais. Grava no `otto.yaml`
 * (acompanha a coleção no Git e em backups). "Auto" e "Initials" voltam ao comportamento padrão.
 */
@Component({
    selector: 'app-collection-avatar-dialog',
    imports: [DialogModule, ButtonModule, CollectionAvatar],
    template: `
        <p-dialog closeAriaLabel="Close" header="Customize avatar" [modal]="true" [visible]="!!collection()" (visibleChange)="!$event && close()" [style]="{ width: '34rem' }" [draggable]="false" appendTo="body">
            @if (collection(); as current) {
                <div class="flex flex-col gap-5">
                    <div class="flex items-center gap-3">
                        <app-collection-avatar [name]="current.metadata.name" [appearance]="{ color: color() ?? undefined, icon: icon() ?? undefined }" size="lg" />
                        <div class="min-w-0">
                            <p class="m-0 truncate font-semibold">{{ current.metadata.name }}</p>
                            <p class="m-0 text-sm text-muted-color">Saved in <code>otto.yaml</code>, so it travels with the collection.</p>
                        </div>
                    </div>

                    <section aria-labelledby="avatar-color-label" class="flex flex-col gap-2">
                        <h2 id="avatar-color-label" class="otto-section-label">Color</h2>
                        <div role="group" aria-labelledby="avatar-color-label" class="flex flex-wrap gap-2">
                            <button
                                type="button"
                                class="otto-avatar-swatch otto-avatar-swatch-auto"
                                [style.--otto-swatch]="'var(--p-' + autoColor() + '-500)'"
                                [attr.aria-pressed]="color() === null"
                                aria-label="Automatic (from the name)"
                                title="Automatic (from the name)"
                                (click)="color.set(null)"
                            >
                                <span aria-hidden="true">A</span>
                            </button>
                            @for (option of colors; track option) {
                                <button
                                    type="button"
                                    class="otto-avatar-swatch"
                                    [style.--otto-swatch]="'var(--p-' + option + '-500)'"
                                    [attr.aria-pressed]="color() === option"
                                    [attr.aria-label]="label(option)"
                                    [title]="label(option)"
                                    (click)="color.set(option)"
                                ></button>
                            }
                        </div>
                    </section>

                    <section aria-labelledby="avatar-icon-label" class="flex flex-col gap-2">
                        <h2 id="avatar-icon-label" class="otto-section-label">Icon</h2>
                        <div role="group" aria-labelledby="avatar-icon-label" class="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1.5">
                            <button type="button" class="otto-avatar-choice text-xs font-bold" [attr.aria-pressed]="icon() === null" aria-label="Initials" title="Initials" (click)="icon.set(null)">{{ initials() }}</button>
                            @for (option of icons; track option) {
                                <button type="button" class="otto-avatar-choice" [attr.aria-pressed]="icon() === option" [attr.aria-label]="label(option)" [title]="label(option)" (click)="icon.set(option)">
                                    <i [class]="'pi pi-' + option" aria-hidden="true"></i>
                                </button>
                            }
                        </div>
                    </section>
                </div>
            }
            <ng-template #footer>
                <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="close()" />
                <p-button label="Save" icon="pi pi-check" [loading]="saving()" [disabled]="!changed()" (onClick)="save()" />
            </ng-template>
        </p-dialog>
    `,
    styles: `
        .otto-avatar-swatch {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 1.75rem;
            height: 1.75rem;
            padding: 0;
            border: 2px solid transparent;
            border-radius: 9999px;
            background: var(--otto-swatch);
            background-clip: padding-box;
            box-shadow: 0 0 0 1px var(--p-content-border-color);
            cursor: pointer;

            &[aria-pressed='true'] {
                box-shadow:
                    0 0 0 2px var(--p-content-background),
                    0 0 0 4px var(--p-text-color);
            }

            &:focus-visible {
                outline: 2px solid var(--p-primary-color);
                outline-offset: 4px;
            }
        }

        /* "Auto": anel com a cor que o nome geraria e um "A" no centro. */
        .otto-avatar-swatch-auto {
            background: var(--p-content-background);
            border-color: var(--otto-swatch);
            color: var(--p-text-color);
            font-size: 0.6875rem;
            font-weight: 700;
        }

        .otto-avatar-choice {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            height: 2.5rem;
            padding: 0;
            border: 1px solid var(--p-content-border-color);
            border-radius: 0.5rem;
            background: transparent;
            color: var(--p-text-color);
            cursor: pointer;
            transition: background-color 120ms ease;

            &:hover {
                background: var(--p-content-hover-background);
            }

            &[aria-pressed='true'] {
                border-color: var(--p-primary-color);
                background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
                color: var(--p-primary-color);
            }

            &:focus-visible {
                outline: 2px solid var(--p-primary-color);
                outline-offset: 1px;
            }
        }
    `
})
export class CollectionAvatarDialog {
    /** Coleção sendo personalizada; `null` = fechado. */
    readonly collectionId = model<EntityId | null>(null);

    private readonly collections = inject(CollectionsState);
    private readonly messages = inject(MessageService);

    protected readonly colors = AVATAR_COLORS;
    protected readonly icons = AVATAR_ICONS;
    protected readonly label = iconLabel;
    protected readonly color = signal<AvatarColor | null>(null);
    protected readonly icon = signal<AvatarIcon | null>(null);
    protected readonly saving = signal(false);

    protected readonly collection = computed(() => this.collections.find(this.collectionId()));
    protected readonly autoColor = computed(() => collectionAccent(this.collection()?.metadata.name ?? ''));
    protected readonly initials = computed(() => collectionInitials(this.collection()?.metadata.name ?? ''));
    protected readonly changed = computed(() => {
        const avatar = this.collection()?.manifest.avatar;

        return (avatar?.color ?? null) !== this.color() || (avatar?.icon ?? null) !== this.icon();
    });

    constructor() {
        // Cada abertura começa com o que está gravado.
        effect(() => {
            const id = this.collectionId();

            untracked(() => {
                const avatar = id ? this.collections.find(id)?.manifest.avatar : undefined;

                this.color.set(avatar?.color ?? null);
                this.icon.set(avatar?.icon ?? null);
            });
        });
    }

    protected async save(): Promise<void> {
        const id = this.collectionId();
        const color = this.color();
        const icon = this.icon();

        if (!id || this.saving()) {
            return;
        }

        this.saving.set(true);

        try {
            await this.collections.updateManifest(id, { avatar: color || icon ? { ...(color && { color }), ...(icon && { icon }) } : null });
            this.collectionId.set(null);
        } catch (error) {
            this.messages.add({ severity: 'error', summary: 'Could not save the avatar', detail: ipcErrorMessage(error), life: 6000 });
        } finally {
            this.saving.set(false);
        }
    }

    protected close(): void {
        if (!this.saving()) {
            this.collectionId.set(null);
        }
    }
}
