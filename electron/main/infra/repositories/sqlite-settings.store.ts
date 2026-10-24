import type { DatabaseSync } from 'node:sqlite';
import type { ClientCertificate, OttoSettings, SettingsPatch } from '../../../shared/models';
import type { IClock, ISecretCipher, ISettingsStore, IWindowStateStore, WindowBounds } from '../../core/contracts';
import { buildSettings, flattenSettingsPatch, parseWindowBounds } from '../../core/validation';
import { fromSqlJson, transaction } from '../database/sqlite';

const WINDOW_BOUNDS_KEY = 'window.bounds';
const CLIENT_CERTIFICATES_KEY = 'http.ssl.clientCertificates';

interface SettingRow {
    key: string;
    value: string;
}

/**
 * Preferências em uma tabela chave/valor: uma linha por folha do esquema
 * (`theme`, `http.proxy.url`...), com o valor em JSON. Valores ausentes ou
 * inválidos caem no padrão (`DEFAULT_SETTINGS`). Com `cipher`, as senhas dos
 * certificados de cliente ficam cifradas no banco (chaveiro do sistema).
 */
export class SqliteSettingsStore implements ISettingsStore, IWindowStateStore {
    constructor(
        private readonly db: DatabaseSync,
        private readonly clock: IClock,
        private readonly cipher?: ISecretCipher
    ) {}

    get(): OttoSettings {
        const rows = this.db.prepare('SELECT key, value FROM settings').all() as unknown as SettingRow[];
        const settings = buildSettings(new Map(rows.map((row) => [row.key, fromSqlJson<unknown>(row.value, undefined)])));
        const cipher = this.cipher;

        if (cipher) {
            settings.http.ssl.clientCertificates = settings.http.ssl.clientCertificates.map((c) => ({ ...c, passphrase: cipher.decrypt(c.passphrase) }));
        }

        return settings;
    }

    update(patch: SettingsPatch): OttoSettings {
        transaction(this.db, () => {
            for (const [key, value] of flattenSettingsPatch(patch)) {
                this.write(key, key === CLIENT_CERTIFICATES_KEY ? this.encryptPassphrases(value as ClientCertificate[]) : value);
            }
        });

        return this.get();
    }

    getBounds(): WindowBounds | undefined {
        const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(WINDOW_BOUNDS_KEY) as SettingRow | undefined;

        return parseWindowBounds(fromSqlJson<unknown>(row?.value, undefined)) ?? undefined;
    }

    setBounds(bounds: WindowBounds): void {
        const { x, y, width, height } = bounds;

        this.write(WINDOW_BOUNDS_KEY, { x, y, width, height });
    }

    private encryptPassphrases(certificates: ClientCertificate[]): ClientCertificate[] {
        const cipher = this.cipher;

        return cipher ? certificates.map((c) => ({ ...c, passphrase: cipher.encrypt(c.passphrase) })) : certificates;
    }

    private write(key: string, value: unknown): void {
        this.db
            .prepare(
                `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
            )
            .run(key, JSON.stringify(value), this.clock.now());
    }
}
