import { Component, computed, input } from '@angular/core';
import type { ScriptMode } from '@shared/models';
import type { ScriptSecurityStatus } from '../core/scripting/script-security.state';

export type SecurityIconKind = 'trusted' | 'ask' | 'blocked';

/** Escudo e glifos (os mesmos de `assets/icons/security-*.svg`, viewBox 24, traço 2.25). */
const SHIELD = 'M12 2.75 4.5 5.6v5.65c0 4.7 3.2 8.55 7.5 9.95 4.3-1.4 7.5-5.25 7.5-9.95V5.6Z';

const GLYPHS: Record<SecurityIconKind, string | null> = {
    trusted: 'm8.75 11.9 2.4 2.4 4.35-4.6',
    ask: null,
    blocked: 'm9.5 9.25 5 5m0-5-5 5'
};

/** Tons (AA nos dois temas) usados com o ícone. */
const TONES = {
    trusted: 'text-green-700 dark:text-green-400',
    session: 'text-blue-700 dark:text-blue-300',
    ask: 'text-amber-800 dark:text-amber-300',
    blocked: 'text-red-700 dark:text-red-400'
} as const;

/** Ícone e tom de cada estado dos scripts da coleção. */
export const securityIconOf = (status: Exclude<ScriptSecurityStatus, 'none'>): { kind: SecurityIconKind; tone: string } => {
    switch (status) {
        case 'trusted':
            return { kind: 'trusted', tone: TONES.trusted };
        case 'session':
            return { kind: 'trusted', tone: TONES.session };
        case 'refused':
        case 'disabled':
            return { kind: 'blocked', tone: TONES.blocked };
        default:
            return { kind: 'ask', tone: TONES.ask };
    }
};

/** Ícone e tom de cada modo salvo. */
export const securityModeIcon = (mode: ScriptMode): { kind: SecurityIconKind; tone: string } => securityIconOf(mode);

/**
 * Escudo de segurança dos scripts (trusted ✓, ask, blocked ✗), em SVG inline com
 * `currentColor`: tamanho e cor vêm das classes de quem usa (`size-3.5 text-green-700`).
 * Decorativo: o texto/rótulo ao lado descreve o estado.
 */
@Component({
    selector: 'app-security-icon',
    template: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" class="size-full">
            <path [attr.d]="shield" fill="currentColor" fill-opacity="0.18" />
            @if (glyph(); as d) {
                <path [attr.d]="d" />
            }
        </svg>
    `,
    host: { class: 'inline-flex shrink-0' }
})
export class SecurityIcon {
    readonly kind = input.required<SecurityIconKind>();

    protected readonly shield = SHIELD;
    protected readonly glyph = computed(() => GLYPHS[this.kind()]);
}
