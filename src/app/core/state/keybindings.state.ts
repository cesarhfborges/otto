import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { commandMeta, defaultChords, sameChords, type CommandId, type KeybindingOverrides, type KeyChord } from '@shared/models';
import { BridgeUnavailableError } from '../bridge/otto-api.token';
import { ipcErrorMessage } from '../bridge/ipc-error';
import { IS_MAC } from '../keyboard/platform';
import { KeybindingsGateway } from '../ports';

export type KeybindingsSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Atalhos personalizados pelo usuário (só as diferenças em relação ao padrão).
 * Alterações são otimistas: o estado muda na hora e volta atrás se o main rejeitar.
 * Fora do Electron ficam só em memória.
 */
@Injectable({ providedIn: 'root' })
export class KeybindingsState {
    private readonly gateway = inject(KeybindingsGateway);
    private readonly mac = inject(IS_MAC);
    private readonly state = signal<KeybindingOverrides>({});
    private readonly statusState = signal<KeybindingsSaveStatus>('idle');
    private readonly errorState = signal<string | null>(null);
    private bridgeAvailable = true;

    readonly overrides = this.state.asReadonly();
    readonly status = this.statusState.asReadonly();
    readonly error = this.errorState.asReadonly();

    constructor() {
        inject(DestroyRef).onDestroy(this.gateway.onChanged((overrides) => this.state.set(overrides)));
        void this.load();
    }

    async load(): Promise<void> {
        try {
            this.state.set(await this.gateway.get());
        } catch (error) {
            if (error instanceof BridgeUnavailableError) {
                this.bridgeAvailable = false;
            } else {
                console.error('[otto] failed to load keyboard shortcuts', error);
            }
        }
    }

    /** Define os atalhos de vários comandos de uma vez (ex.: "Replace" tira de um e põe em outro). */
    apply(changes: Partial<Record<CommandId, readonly KeyChord[]>>): Promise<void> {
        const next: KeybindingOverrides = { ...this.state() };

        for (const [id, chords] of Object.entries(changes) as Array<[CommandId, readonly KeyChord[]]>) {
            if (sameChords(chords, defaultChords(commandMeta(id), this.mac))) {
                delete next[id];
            } else {
                next[id] = [...chords];
            }
        }

        return this.save(next, () => this.gateway.set(next));
    }

    /** Restaura o padrão de um comando ou, sem `id`, de todos. */
    reset(id?: CommandId): Promise<void> {
        const next: KeybindingOverrides = { ...this.state() };

        if (id) {
            delete next[id];
        }

        return this.save(id ? next : {}, () => this.gateway.reset(id));
    }

    private async save(next: KeybindingOverrides, persist: () => Promise<KeybindingOverrides>): Promise<void> {
        const previous = this.state();

        this.state.set(next);

        if (!this.bridgeAvailable) {
            this.statusState.set('saved');

            return;
        }

        this.statusState.set('saving');

        try {
            this.state.set(await persist());
            this.errorState.set(null);
            this.statusState.set('saved');
        } catch (error) {
            this.state.set(previous);
            this.errorState.set(ipcErrorMessage(error));
            this.statusState.set('error');
        }
    }
}
