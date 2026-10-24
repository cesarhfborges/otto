/** Cifra dos valores secretos guardados no banco local (cofre). */
export interface ISecretCipher {
    /** `os`: chaveiro do sistema; `basic`: chave fixa (só ofusca); `unavailable`: guarda em texto puro. */
    readonly storage: 'os' | 'basic' | 'unavailable';
    /** Texto cifrado, com prefixo que o identifica. Sem cifra disponível, devolve o próprio valor. */
    encrypt(plain: string): string;
    /** Aceita valores antigos em texto puro (sem prefixo). */
    decrypt(stored: string): string;
    isEncrypted(stored: string): boolean;
}
