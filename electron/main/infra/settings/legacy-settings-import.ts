import * as fs from 'node:fs';
import type { ISettingsStore, IWindowStateStore } from '../../core/contracts';
import { isRecord, parseWindowBounds } from '../../core/validation';

/**
 * Importa uma única vez o `settings.json` das versões anteriores à Etapa 2
 * para o SQLite e renomeia o arquivo para `settings.json.migrated`.
 * Retorna `true` quando houve importação.
 */
export function importLegacySettings(file: string, target: ISettingsStore & IWindowStateStore): boolean {
    let raw: unknown;

    try {
        raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }

        console.warn('[otto] settings.json legado ilegível; ignorando:', error);
        raw = {};
    }

    // O formato antigo só tinha `minimizeToTray` e `windowBounds`; valores inválidos são ignorados.
    const legacy = isRecord(raw) ? raw : {};

    if (typeof legacy['minimizeToTray'] === 'boolean') {
        target.update({ minimizeToTray: legacy['minimizeToTray'] });
    }

    const bounds = parseWindowBounds(legacy['windowBounds']);

    if (bounds) {
        target.setBounds(bounds);
    }

    fs.renameSync(file, `${file}.migrated`);

    return true;
}
