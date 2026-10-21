import { normalizeChord } from '../../../shared/keyboard/chord';
import { COMMAND_IDS, commandMeta, defaultChords, isCommandId, MAX_CHORDS_PER_COMMAND, reservedChords, sameChords, type CommandId, type KeybindingOverrides, type KeyChord } from '../../../shared/models';
import { requireArray, requireRecord, requireString, ValidationError } from './guards';

/**
 * Converte os overrides de atalhos. `strict` (vindo do renderer) rejeita comandos e
 * teclas inválidos; sem `strict` (lido do banco) eles são descartados em silêncio,
 * para que IDs de outras versões do app não impeçam a leitura.
 */
export function parseKeybindingOverrides(raw: unknown, mac: boolean, strict: boolean): KeybindingOverrides {
    if (!strict && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) {
        return {};
    }

    const record = requireRecord(raw, 'keybindings');
    const reserved = reservedChords(mac);
    const result: KeybindingOverrides = {};

    for (const [id, value] of Object.entries(record)) {
        if (!isCommandId(id)) {
            if (strict) {
                throw new ValidationError(`keybindings.${id}`, 'unknown command');
            }

            continue;
        }

        if (commandMeta(id).fixed) {
            if (strict) {
                throw new ValidationError(`keybindings.${id}`, 'this shortcut is reserved by the system and cannot be changed');
            }

            continue;
        }

        try {
            const chords: KeyChord[] = [];

            for (const [index, item] of requireArray(value, `keybindings.${id}`, MAX_CHORDS_PER_COMMAND).entries()) {
                const field = `keybindings.${id}[${index}]`;
                const chord = normalizeChord(requireString(item, field, { maxLength: 64 }), mac);

                if (!chord) {
                    throw new ValidationError(field, 'invalid key combination');
                }

                if (reserved.has(chord)) {
                    throw new ValidationError(field, `${chord} is reserved by the system`);
                }

                if (!chords.includes(chord)) {
                    chords.push(chord);
                }
            }

            // Igual ao padrão não é override: o comando acompanha os padrões de versões futuras.
            if (!sameChords(chords, defaultChords(commandMeta(id), mac))) {
                result[id] = chords;
            }
        } catch (error) {
            if (strict) {
                throw error;
            }
        }
    }

    return result;
}

export function parseCommandId(raw: unknown, field = 'id'): CommandId {
    if (!isCommandId(raw)) {
        throw new ValidationError(field, `expected one of ${COMMAND_IDS.length} known commands`);
    }

    return raw;
}
