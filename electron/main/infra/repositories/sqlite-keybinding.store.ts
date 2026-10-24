import type { DatabaseSync } from 'node:sqlite';
import type { KeybindingOverrides } from '../../../shared/models';
import type { IClock, IKeybindingStore } from '../../core/contracts';
import { parseKeybindingOverrides } from '../../core/validation';
import { fromSqlJson } from '../database/sqlite';

const KEYBINDINGS_KEY = 'keybindings';

/**
 * Atalhos personalizados numa linha própria da tabela `settings` (um mapa não cabe
 * no modelo de folhas das preferências). Valores inválidos são descartados ao ler.
 */
export class SqliteKeybindingStore implements IKeybindingStore {
    constructor(
        private readonly db: DatabaseSync,
        private readonly clock: IClock,
        private readonly mac: boolean
    ) {}

    get(): KeybindingOverrides {
        const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(KEYBINDINGS_KEY) as { value: string } | undefined;

        return parseKeybindingOverrides(fromSqlJson<unknown>(row?.value, {}), this.mac, false);
    }

    set(overrides: KeybindingOverrides): void {
        this.db
            .prepare(
                `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
            )
            .run(KEYBINDINGS_KEY, JSON.stringify(overrides), this.clock.now());
    }
}
