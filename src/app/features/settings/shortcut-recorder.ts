import { afterNextRender, Component, DestroyRef, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { eventModifiers, eventToChord, type KeyChord } from '@shared/keyboard/chord';
import { KeybindingService } from '../../core/keyboard/keybinding.service';

let nextId = 0;

/**
 * Captura uma combinação de teclas. Enquanto existe, os atalhos do app ficam
 * suspensos (gravar `Ctrl+W` não fecha a aba). `Escape` cancela sem fechar o modal
 * de Preferences; `Tab` cancela e deixa o foco seguir.
 */
@Component({
    selector: 'app-shortcut-recorder',
    template: `
        <div
            #box
            role="textbox"
            aria-readonly="true"
            tabindex="0"
            [attr.aria-label]="label()"
            [attr.aria-describedby]="hintId + (error() ? ' ' + errorId : '')"
            [attr.aria-invalid]="error() ? true : null"
            class="flex h-8 min-w-48 cursor-text items-center gap-2 rounded-md border-2 border-dashed px-2 text-sm outline-none focus-visible:border-solid"
            [class]="error() ? 'border-red-600 dark:border-red-400' : 'border-primary'"
            (keydown)="onKeydown($event)"
            (keyup)="onKeyup($event)"
            (focusout)="cancel()"
        >
            @if (preview(); as keys) {
                <kbd class="font-sans">{{ keys }}</kbd>
            } @else {
                <span class="text-muted-color">{{ placeholder() }}</span>
            }
        </div>
        <span [id]="hintId" class="sr-only">Press the new shortcut. Escape cancels.</span>
        @if (error(); as message) {
            <small [id]="errorId" role="alert" class="text-red-700 dark:text-red-400">{{ message }}</small>
        }
    `,
    host: { class: 'flex flex-col gap-1' }
})
export class ShortcutRecorder {
    readonly label = input.required<string>();
    readonly placeholder = input('Press the new shortcut…');
    readonly error = input<string | null>(null);
    readonly captured = output<KeyChord>();
    readonly cancelled = output<void>();

    protected readonly hintId = `shortcut-recorder-hint-${nextId}`;
    protected readonly errorId = `shortcut-recorder-error-${nextId++}`;
    protected readonly preview = signal('');

    private readonly keyboard = inject(KeybindingService);
    private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');
    private active = true;

    constructor() {
        this.keyboard.suspend();
        inject(DestroyRef).onDestroy(() => {
            this.active = false;
            this.keyboard.resume();
        });
        afterNextRender(() => this.box().nativeElement.focus());
    }

    protected onKeydown(event: KeyboardEvent): void {
        if (event.isComposing) {
            return;
        }

        const chord = eventToChord(event, this.keyboard.mac);

        // Tab sai da gravação sem prender o foco (WCAG 2.1.2).
        if (chord === 'Tab' || chord === 'Shift+Tab') {
            this.cancel();

            return;
        }

        // Nada chega ao app nem ao diálogo (o Escape do p-dialog escuta no document).
        event.preventDefault();
        event.stopPropagation();

        if (!chord) {
            const held = eventModifiers(event, this.keyboard.mac);

            this.preview.set(held.length ? `${held.join(this.keyboard.mac ? '' : ' + ')}${this.keyboard.mac ? '' : ' + '}…` : '');

            return;
        }

        if (chord === 'Escape') {
            this.cancel();

            return;
        }

        this.preview.set(this.keyboard.format(chord));

        if (this.active) {
            this.captured.emit(chord);
        }
    }

    /** Soltar os modificadores sem completar a combinação limpa a prévia. */
    protected onKeyup(event: KeyboardEvent): void {
        if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && this.preview().endsWith('…')) {
            this.preview.set('');
        }
    }

    protected cancel(): void {
        if (this.active) {
            this.active = false;
            this.cancelled.emit();
        }
    }
}
