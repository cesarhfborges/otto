import { safeStorage } from 'electron';
import type { ISecretCipher } from '../../core/contracts';

const PREFIX = 'otto-enc:v1:';

/**
 * Cofre sobre o `safeStorage` do Electron: Keychain (macOS), DPAPI (Windows) ou
 * libsecret/kwallet (Linux). A chave nunca sai da máquina. Deve ser criado após `app.whenReady()`.
 */
export function createSafeStorageCipher(): ISecretCipher {
    const available = safeStorage.isEncryptionAvailable();
    const storage = !available ? 'unavailable' : process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text' ? 'basic' : 'os';

    return {
        storage,
        isEncrypted: (stored) => stored.startsWith(PREFIX),
        encrypt: (plain) => (available && plain ? PREFIX + safeStorage.encryptString(plain).toString('base64') : plain),
        decrypt: (stored) => {
            if (!stored.startsWith(PREFIX)) {
                return stored;
            }

            try {
                return safeStorage.decryptString(Buffer.from(stored.slice(PREFIX.length), 'base64'));
            } catch {
                // Chaveiro trocado ou indisponível: o valor não pode ser recuperado.
                return '';
            }
        }
    };
}
