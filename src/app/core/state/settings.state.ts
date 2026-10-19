import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { DEFAULT_SETTINGS, type OttoSettings, type SettingsPatch } from '@shared/models';
import { BridgeUnavailableError } from '../bridge/otto-api.token';
import { ipcErrorMessage } from '../bridge/ipc-error';
import { SettingsGateway } from '../ports';

type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject => !!value && typeof value === 'object' && !Array.isArray(value);

/** Aplica um patch profundo sobre as settings (usado só fora do Electron, sem o main para validar). */
function mergeSettings(target: PlainObject, patch: PlainObject): PlainObject {
    const result: PlainObject = { ...target };

    for (const [key, value] of Object.entries(patch)) {
        result[key] = isPlainObject(value) && isPlainObject(target[key]) ? mergeSettings(target[key], value) : value;
    }

    return result;
}

/**
 * Estado global das preferências no renderer (signals).
 * A fonte da verdade é o main: alterações passam pelo IPC e o valor devolvido
 * (já validado) substitui o estado local. Mudanças feitas pelo tray chegam via evento.
 */
@Injectable({ providedIn: 'root' })
export class SettingsState {
    private readonly gateway = inject(SettingsGateway);
    private readonly state = signal<OttoSettings>(structuredClone(DEFAULT_SETTINGS) as OttoSettings);
    private readonly loadedState = signal(false);
    private readonly bridgeAvailable = signal(true);

    readonly settings = this.state.asReadonly();
    readonly loaded = this.loadedState.asReadonly();
    /** `false` quando roda no navegador (`npm run web:serve`): alterações ficam só em memória. */
    readonly persistent = this.bridgeAvailable.asReadonly();

    constructor() {
        const unsubscribe = this.gateway.onChanged((settings) => this.state.set(settings));

        inject(DestroyRef).onDestroy(unsubscribe);
        void this.load();
    }

    async load(): Promise<void> {
        try {
            this.state.set(await this.gateway.get());
        } catch (error) {
            if (error instanceof BridgeUnavailableError) {
                this.bridgeAvailable.set(false);
            } else {
                console.error('[otto] failed to load settings', error);
            }
        } finally {
            this.loadedState.set(true);
        }
    }

    /** Persiste o patch. Lança um `Error` com mensagem amigável se o main rejeitar. */
    async update(patch: SettingsPatch): Promise<OttoSettings> {
        if (!this.bridgeAvailable()) {
            this.state.update((current) => mergeSettings(current as unknown as PlainObject, patch as PlainObject) as unknown as OttoSettings);

            return this.state();
        }

        try {
            const saved = await this.gateway.set(patch);

            this.state.set(saved);

            return saved;
        } catch (error) {
            throw new Error(ipcErrorMessage(error));
        }
    }
}
