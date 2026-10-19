import { EventEmitter } from 'node:events';
import type { OttoSettings, SettingsPatch } from '../../../shared/models';
import type { ISettingsService, ISettingsStore } from '../../core/contracts';

/**
 * Decorator sobre o store que notifica mudanças. Mantém uma cópia em memória
 * para leituras frequentes (tray, executor HTTP) sem ir ao banco.
 */
export class SettingsService implements ISettingsService {
    private readonly events = new EventEmitter<{ change: [OttoSettings] }>();
    private cache: OttoSettings | null = null;

    constructor(private readonly store: ISettingsStore) {}

    get(): OttoSettings {
        this.cache ??= this.store.get();

        return structuredClone(this.cache);
    }

    update(patch: SettingsPatch): OttoSettings {
        const before = JSON.stringify(this.get());

        this.cache = this.store.update(patch);

        if (JSON.stringify(this.cache) !== before) {
            this.events.emit('change', structuredClone(this.cache));
        }

        return structuredClone(this.cache);
    }

    onChange(listener: (settings: OttoSettings) => void): () => void {
        this.events.on('change', listener);

        return () => this.events.off('change', listener);
    }
}
