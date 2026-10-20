import * as path from 'node:path';
import { CODE_THEMES, DEFAULT_SETTINGS, MAX_CODE_FONT_SIZE, MIN_CODE_FONT_SIZE, MAX_HISTORY_ENTRIES, MAX_TIMEOUT_MS, REQUEST_LAYOUTS, THEME_MODES, type OttoSettings, type SettingsPatch } from '../../../shared/models';
import type { WindowBounds } from '../contracts';
import { isRecord, optionalString, requireBoolean, requireInteger, requireOneOf, requireRecord, requireString, ValidationError } from './guards';

/** Uma preferência "folha" (valor primitivo), identificada pelo caminho no objeto de settings. */
export interface SettingLeaf {
    readonly path: readonly string[];
    readonly key: string;
    parse(value: unknown, field: string): unknown;
}

function parseTimeout(value: unknown, field: string): number {
    const ms = requireInteger(value, field, 0);

    if (ms > MAX_TIMEOUT_MS) {
        throw new ValidationError(field, `must be at most ${MAX_TIMEOUT_MS}`);
    }

    return ms;
}

function parseProxyUrl(value: unknown, field: string): string {
    const url = requireString(value, field, { allowEmpty: true, maxLength: 2_048 }).trim();

    if (!url) {
        return '';
    }

    let parsed: URL;

    try {
        parsed = new URL(url);
    } catch {
        throw new ValidationError(field, 'must be a valid URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ValidationError(field, 'only http:// and https:// proxies are supported');
    }

    return url;
}

/** Caminho absoluto opcional (vazio → `null`). Usado pelo certificado de CA e pela pasta base. */
function parseCertificatePath(value: unknown, field: string): string | null {
    const file = optionalString(value, field, { allowEmpty: true, maxLength: 4_096 });

    if (file === null || !file.trim()) {
        return null;
    }

    if (!path.isAbsolute(file)) {
        throw new ValidationError(field, 'must be an absolute path');
    }

    return path.normalize(file);
}

const leaf = (keyPath: string, parse: SettingLeaf['parse']): SettingLeaf => ({ path: keyPath.split('.'), key: keyPath, parse });

/** Esquema de todas as preferências persistidas (uma linha por folha na tabela `settings`). */
export const SETTING_LEAVES: readonly SettingLeaf[] = [
    leaf('minimizeToTray', requireBoolean),
    leaf('theme', (v, f) => requireOneOf(v, THEME_MODES, f)),
    leaf('appearance.requestLayout', (v, f) => requireOneOf(v, REQUEST_LAYOUTS, f)),
    leaf('appearance.codeTheme', (v, f) => requireOneOf(v, CODE_THEMES, f)),
    leaf('appearance.codeFontSize', (v, f) => requireInteger(v, f, MIN_CODE_FONT_SIZE, MAX_CODE_FONT_SIZE)),
    leaf('http.timeoutMs', parseTimeout),
    leaf('http.followRedirects', requireBoolean),
    leaf('http.proxy.enabled', requireBoolean),
    leaf('http.proxy.url', parseProxyUrl),
    leaf('http.proxy.bypass', (v, f) => requireString(v, f, { allowEmpty: true, maxLength: 2_000 }).trim()),
    leaf('http.ssl.verifyCertificates', requireBoolean),
    leaf('http.ssl.caCertificatePath', parseCertificatePath),
    leaf('workspaces.baseDirectory', (v, f) => parseCertificatePath(v, f) ?? ''),
    leaf('history.maxEntries', (v, f) => requireInteger(v, f, 0, MAX_HISTORY_ENTRIES))
];

/** `undefined` quando algum nível do caminho não existe. Lança se um nível intermediário não for objeto. */
function readPath(source: Record<string, unknown>, keyPath: readonly string[], field: string): unknown {
    let current: unknown = source;

    for (const [i, segment] of keyPath.entries()) {
        if (current === undefined) {
            return undefined;
        }

        current = requireRecord(current, i === 0 ? field : `${field}.${keyPath.slice(0, i).join('.')}`)[segment];
    }

    return current;
}

function writePath(target: Record<string, unknown>, keyPath: readonly string[], value: unknown): void {
    let current = target;

    for (const segment of keyPath.slice(0, -1)) {
        if (!isRecord(current[segment])) {
            current[segment] = {};
        }

        current = current[segment] as Record<string, unknown>;
    }

    current[keyPath.at(-1)!] = value;
}

/**
 * Valida uma alteração parcial vinda do renderer. Campos desconhecidos são
 * ignorados; campos conhecidos com valor inválido lançam `ValidationError`.
 */
export function parseSettingsPatch(raw: unknown): SettingsPatch {
    const source = requireRecord(raw, 'settings');
    const patch: Record<string, unknown> = {};

    for (const setting of SETTING_LEAVES) {
        const value = readPath(source, setting.path, 'settings');

        if (value !== undefined) {
            writePath(patch, setting.path, setting.parse(value, `settings.${setting.key}`));
        }
    }

    return patch as SettingsPatch;
}

/** Lista as folhas presentes em um patch (já validado) como pares chave/valor. */
export function flattenSettingsPatch(patch: SettingsPatch): Array<[key: string, value: unknown]> {
    const entries: Array<[string, unknown]> = [];

    for (const setting of SETTING_LEAVES) {
        const value = readPath(patch as Record<string, unknown>, setting.path, 'settings');

        if (value !== undefined) {
            entries.push([setting.key, value]);
        }
    }

    return entries;
}

/** Monta as settings completas: valores armazenados válidos sobrepõem os padrões. */
export function buildSettings(stored: ReadonlyMap<string, unknown>): OttoSettings {
    const settings = structuredClone(DEFAULT_SETTINGS) as OttoSettings;

    for (const setting of SETTING_LEAVES) {
        if (!stored.has(setting.key)) {
            continue;
        }

        try {
            writePath(settings as unknown as Record<string, unknown>, setting.path, setting.parse(stored.get(setting.key), setting.key));
        } catch {
            // Valor corrompido/obsoleto no banco: mantém o padrão.
        }
    }

    return settings;
}

export function parseWindowBounds(raw: unknown): WindowBounds | null {
    if (!isRecord(raw)) {
        return null;
    }

    const { x, y, width, height } = raw;
    const values = [x, y, width, height];

    return values.every((n) => typeof n === 'number' && Number.isFinite(n)) ? { x: x as number, y: y as number, width: width as number, height: height as number } : null;
}
