import { EventEmitter } from 'node:events';
import type { CommandId, KeybindingOverrides } from '../../../shared/models';
import type { IKeybindingService, IKeybindingStore } from '../../core/contracts';

/** Decorator sobre o store que mantém cache e notifica mudanças (menu nativo e renderer). */
export class KeybindingService implements IKeybindingService {
    private readonly events = new EventEmitter<{ change: [KeybindingOverrides] }>();
    private cache: KeybindingOverrides | null = null;

    constructor(private readonly store: IKeybindingStore) {}

    get(): KeybindingOverrides {
        this.cache ??= this.store.get();

        return structuredClone(this.cache);
    }

    set(overrides: KeybindingOverrides): KeybindingOverrides {
        const before = JSON.stringify(this.get());

        this.store.set(overrides);
        this.cache = this.store.get();

        if (JSON.stringify(this.cache) !== before) {
            this.events.emit('change', structuredClone(this.cache));
        }

        return structuredClone(this.cache);
    }

    reset(id?: CommandId): KeybindingOverrides {
        if (!id) {
            return this.set({});
        }

        const { [id]: _removed, ...rest } = this.get();

        return this.set(rest);
    }

    onChange(listener: (overrides: KeybindingOverrides) => void): () => void {
        this.events.on('change', listener);

        return () => this.events.off('change', listener);
    }
}
