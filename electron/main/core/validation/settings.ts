import * as path from 'node:path';
import {
    CODE_THEMES,
    DEFAULT_SETTINGS,
    MAX_CLIENT_CERTIFICATES,
    MAX_CODE_FONT_SIZE,
    MIN_CODE_FONT_SIZE,
    MAX_TIMEOUT_MS,
    PRIMARY_COLORS,
    REQUEST_LAYOUTS,
    SURFACE_COLORS,
    THEME_MODES,
    THEME_PRESETS,
    type ClientCertificate,
    type OttoSettings,
    type SettingsPatch
} from '../../../shared/models';
import type { WindowBounds } from '../contracts';
import { isRecord, optionalString, requireArray, requireBoolean, requireInteger, requireOneOf, requireRecord, requireString, ValidationError } from './guards';

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

const PROXY_PROTOCOLS = ['http:', 'https:', 'socks5:', 'socks:'];

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

    if (!PROXY_PROTOCOLS.includes(parsed.protocol)) {
        throw new ValidationError(field, 'only http://, https:// and socks5:// proxies are supported');
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

/** `api.example.com`, `*.example.com`, `10.0.0.5:8443`... (sem esquema nem caminho). */
const CERTIFICATE_HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

function parseClientCertificates(value: unknown, field: string): ClientCertificate[] {
    return requireArray(value, field, MAX_CLIENT_CERTIFICATES).map((item, i) => {
        const at = `${field}[${i}]`;
        const entry = requireRecord(item, at);
        const host = requireString(entry['host'], `${at}.host`, { maxLength: 255 }).trim().toLowerCase();

        if (!CERTIFICATE_HOST.test(host)) {
            throw new ValidationError(`${at}.host`, 'must be a host name, optionally with *. and :port');
        }

        const certificate: ClientCertificate = {
            host,
            certPath: parseCertificatePath(entry['certPath'] ?? null, `${at}.certPath`),
            keyPath: parseCertificatePath(entry['keyPath'] ?? null, `${at}.keyPath`),
            pfxPath: parseCertificatePath(entry['pfxPath'] ?? null, `${at}.pfxPath`),
            passphrase: requireString(entry['passphrase'] ?? '', `${at}.passphrase`, { allowEmpty: true, maxLength: 1_024 })
        };

        if (!certificate.pfxPath && !(certificate.certPath && certificate.keyPath)) {
            throw new ValidationError(at, 'needs a PFX file or both a certificate and a key file');
        }

        return certificate;
    });
}

const leaf = (keyPath: string, parse: SettingLeaf['parse']): SettingLeaf => ({ path: keyPath.split('.'), key: keyPath, parse });

/** Esquema de todas as preferências persistidas (uma linha por folha na tabela `settings`). */
export const SETTING_LEAVES: readonly SettingLeaf[] = [
    leaf('showTrayIcon', requireBoolean),
    leaf('minimizeToTray', requireBoolean),
    leaf('hardwareAcceleration', requireBoolean),
    leaf('theme', (v, f) => requireOneOf(v, THEME_MODES, f)),
    leaf('appearance.themePreset', (v, f) => requireOneOf(v, THEME_PRESETS, f)),
    leaf('appearance.primaryColor', (v, f) => requireOneOf(v, PRIMARY_COLORS, f)),
    leaf('appearance.surfaceColor', (v, f) => (v === null ? null : requireOneOf(v, SURFACE_COLORS, f))),
    leaf('appearance.requestLayout', (v, f) => requireOneOf(v, REQUEST_LAYOUTS, f)),
    leaf('appearance.showQueryInUrl', requireBoolean),
    leaf('appearance.codeTheme', (v, f) => requireOneOf(v, CODE_THEMES, f)),
    leaf('appearance.codeFontSize', (v, f) => requireInteger(v, f, MIN_CODE_FONT_SIZE, MAX_CODE_FONT_SIZE)),
    leaf('http.timeoutMs', parseTimeout),
    leaf('http.followRedirects', requireBoolean),
    leaf('http.proxy.enabled', requireBoolean),
    leaf('http.proxy.url', parseProxyUrl),
    leaf('http.proxy.bypass', (v, f) => requireString(v, f, { allowEmpty: true, maxLength: 2_000 }).trim()),
    leaf('http.ssl.verifyCertificates', requireBoolean),
    leaf('http.ssl.caCertificatePath', parseCertificatePath),
    leaf('http.ssl.clientCertificates', parseClientCertificates),
    leaf('workspaces.baseDirectory', (v, f) => parseCertificatePath(v, f) ?? ''),
    leaf('updates.autoCheck', requireBoolean),
    leaf('updates.autoDownload', requireBoolean)
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
