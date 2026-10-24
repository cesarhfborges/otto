/**
 * MD4 (RFC 1320), usado só no hash NT do NTLM. O OpenSSL 3 do Node/Electron
 * não oferece mais MD4 no `crypto` (algoritmo legado), por isso a implementação própria.
 */
export function md4(input: Uint8Array): Buffer {
    const bitLength = input.length * 8;
    const padded = new Uint8Array((((input.length + 8) >> 6) + 1) * 64);

    padded.set(input);
    padded[input.length] = 0x80;

    const view = new DataView(padded.buffer);

    view.setUint32(padded.length - 8, bitLength >>> 0, true);
    view.setUint32(padded.length - 4, Math.floor(bitLength / 2 ** 32), true);

    let a = 0x67452301;
    let b = 0xefcdab89;
    let c = 0x98badcfe;
    let d = 0x10325476;

    const rotl = (x: number, n: number): number => (x << n) | (x >>> (32 - n));
    const f = (x: number, y: number, z: number): number => (x & y) | (~x & z);
    const g = (x: number, y: number, z: number): number => (x & y) | (x & z) | (y & z);
    const h = (x: number, y: number, z: number): number => x ^ y ^ z;

    for (let offset = 0; offset < padded.length; offset += 64) {
        const x = Array.from({ length: 16 }, (_, i) => view.getUint32(offset + i * 4, true));
        const [aa, bb, cc, dd] = [a, b, c, d];

        for (const i of [0, 4, 8, 12]) {
            a = rotl((a + f(b, c, d) + x[i]!) | 0, 3);
            d = rotl((d + f(a, b, c) + x[i + 1]!) | 0, 7);
            c = rotl((c + f(d, a, b) + x[i + 2]!) | 0, 11);
            b = rotl((b + f(c, d, a) + x[i + 3]!) | 0, 19);
        }

        for (const i of [0, 1, 2, 3]) {
            a = rotl((a + g(b, c, d) + x[i]! + 0x5a827999) | 0, 3);
            d = rotl((d + g(a, b, c) + x[i + 4]! + 0x5a827999) | 0, 5);
            c = rotl((c + g(d, a, b) + x[i + 8]! + 0x5a827999) | 0, 9);
            b = rotl((b + g(c, d, a) + x[i + 12]! + 0x5a827999) | 0, 13);
        }

        for (const i of [0, 2, 1, 3]) {
            a = rotl((a + h(b, c, d) + x[i]! + 0x6ed9eba1) | 0, 3);
            d = rotl((d + h(a, b, c) + x[i + 8]! + 0x6ed9eba1) | 0, 9);
            c = rotl((c + h(d, a, b) + x[i + 4]! + 0x6ed9eba1) | 0, 11);
            b = rotl((b + h(c, d, a) + x[i + 12]! + 0x6ed9eba1) | 0, 15);
        }

        a = (a + aa) | 0;
        b = (b + bb) | 0;
        c = (c + cc) | 0;
        d = (d + dd) | 0;
    }

    const out = Buffer.alloc(16);

    [a, b, c, d].forEach((word, i) => out.writeInt32LE(word, i * 4));

    return out;
}
