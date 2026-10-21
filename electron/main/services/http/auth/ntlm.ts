import { createHmac, randomBytes } from 'node:crypto';
import { md4 } from './md4';

const SIGNATURE = Buffer.from('NTLMSSP\0', 'latin1');

/** UNICODE | OEM | REQUEST_TARGET | NTLM | ALWAYS_SIGN | EXTENDED_SESSIONSECURITY. */
const NEGOTIATE_FLAGS = 0x00088207;
const NEGOTIATE_UNICODE = 0x1;
/** Diferença entre 1601-01-01 (FILETIME) e 1970-01-01, em ms. */
const FILETIME_EPOCH_OFFSET_MS = 11_644_473_600_000n;
const MSV_AV_TIMESTAMP = 7;

export interface NtlmCredentials {
    username: string;
    password: string;
    domain: string;
    workstation: string;
}

interface Challenge {
    flags: number;
    serverChallenge: Buffer;
    targetInfo: Buffer;
}

const utf16 = (text: string): Buffer => Buffer.from(text, 'utf16le');

const hmacMd5 = (key: Buffer, ...data: Buffer[]): Buffer => createHmac('md5', key).update(Buffer.concat(data)).digest();

/** Mensagem 1 (Negotiate), sem domínio/estação. */
export function negotiateMessage(): string {
    const message = Buffer.alloc(32);

    SIGNATURE.copy(message, 0);
    message.writeUInt32LE(1, 8);
    message.writeUInt32LE(NEGOTIATE_FLAGS, 12);

    return `NTLM ${message.toString('base64')}`;
}

/** Mensagem 2 (Challenge) do `WWW-Authenticate: NTLM <base64>`. */
function parseChallenge(header: string): Challenge {
    const message = Buffer.from(header.replace(/^NTLM\s*/i, '').split(/[\s,]/)[0] ?? '', 'base64');

    if (message.length < 32 || !message.subarray(0, 8).equals(SIGNATURE) || message.readUInt32LE(8) !== 2) {
        throw new Error('Invalid NTLM challenge from the server');
    }

    const targetInfo = message.length >= 48 ? message.subarray(message.readUInt32LE(44), message.readUInt32LE(44) + message.readUInt16LE(40)) : Buffer.alloc(0);

    return { flags: message.readUInt32LE(20), serverChallenge: message.subarray(24, 32), targetInfo };
}

/** Valor de `MsvAvTimestamp` no TargetInfo, se o servidor enviou. */
function serverTimestamp(targetInfo: Buffer): Buffer | null {
    for (let offset = 0; offset + 4 <= targetInfo.length; ) {
        const id = targetInfo.readUInt16LE(offset);
        const length = targetInfo.readUInt16LE(offset + 2);

        if (id === MSV_AV_TIMESTAMP) {
            return targetInfo.subarray(offset + 4, offset + 4 + length);
        }

        if (id === 0) {
            break;
        }

        offset += 4 + length;
    }

    return null;
}

/** `DOMINIO\usuario` no campo de usuário vale como domínio quando o campo Domain está vazio. */
function splitUser({ username, domain }: NtlmCredentials): { user: string; domain: string } {
    const separator = username.indexOf('\\');

    return !domain && separator > 0 ? { user: username.slice(separator + 1), domain: username.slice(0, separator) } : { user: username, domain };
}

/** Mensagem 3 (Authenticate) com resposta NTLMv2. */
export function authenticateMessage(challengeHeader: string, credentials: NtlmCredentials): string {
    const { flags, serverChallenge, targetInfo } = parseChallenge(challengeHeader);
    const { user, domain } = splitUser(credentials);
    const encode = flags & NEGOTIATE_UNICODE ? utf16 : (text: string) => Buffer.from(text, 'latin1');

    const ntlmV2Hash = hmacMd5(md4(utf16(credentials.password)), utf16(user.toUpperCase() + domain));
    const clientChallenge = randomBytes(8);
    const fromServer = serverTimestamp(targetInfo);
    const timestamp = fromServer ?? Buffer.alloc(8);

    if (!fromServer) {
        timestamp.writeBigUInt64LE((BigInt(Date.now()) + FILETIME_EPOCH_OFFSET_MS) * 10_000n);
    }

    const blob = Buffer.concat([Buffer.from([1, 1, 0, 0, 0, 0, 0, 0]), timestamp, clientChallenge, Buffer.alloc(4), targetInfo, Buffer.alloc(4)]);
    const ntResponse = Buffer.concat([hmacMd5(ntlmV2Hash, serverChallenge, blob), blob]);
    // Com timestamp do servidor, a especificação manda a resposta LM zerada.
    const lmResponse = fromServer ? Buffer.alloc(24) : Buffer.concat([hmacMd5(ntlmV2Hash, serverChallenge, clientChallenge), clientChallenge]);

    const fields = [lmResponse, ntResponse, encode(domain), encode(user), encode(credentials.workstation), Buffer.alloc(0)];
    const header = Buffer.alloc(64);
    let offset = header.length;

    SIGNATURE.copy(header, 0);
    header.writeUInt32LE(3, 8);
    fields.forEach((field, i) => {
        header.writeUInt16LE(field.length, 12 + i * 8);
        header.writeUInt16LE(field.length, 14 + i * 8);
        header.writeUInt32LE(offset, 16 + i * 8);
        offset += field.length;
    });
    header.writeUInt32LE((NEGOTIATE_FLAGS & ~0x2) | (flags & NEGOTIATE_UNICODE), 60);

    return `NTLM ${Buffer.concat([header, ...fields]).toString('base64')}`;
}
