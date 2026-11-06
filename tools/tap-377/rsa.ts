import { bigIntModPow, bigIntToBytes, bytesToBigInt } from '../../src/client/util/JsUtil.js';

export interface RsaPrivateKey { modulus: bigint; privateExponent: bigint }

class Der {
    private position = 0;
    constructor(private readonly bytes: Uint8Array) {}
    get done(): boolean { return this.position === this.bytes.length; }

    element(tag: number): Uint8Array {
        if (this.bytes[this.position++] !== tag) throw new Error('invalid engine key');
        let length = this.bytes[this.position++];
        if (length === undefined) throw new Error('invalid engine key');
        if (length & 0x80) {
            const count = length & 0x7f;
            if (count < 1 || count > 4 || this.position + count > this.bytes.length || this.bytes[this.position] === 0) throw new Error('invalid engine key');
            length = 0;
            for (let i = 0; i < count; i++) length = length * 256 + this.bytes[this.position++];
            if (length < 128) throw new Error('invalid engine key');
        }
        if (this.position + length > this.bytes.length) throw new Error('invalid engine key');
        const value = this.bytes.subarray(this.position, this.position + length);
        this.position += length;
        return value;
    }

    integer(): bigint {
        const bytes = this.element(2);
        if (!bytes.length || (bytes[0] & 0x80) || (bytes.length > 1 && bytes[0] === 0 && !(bytes[1] & 0x80))) throw new Error('invalid engine key');
        return bytesToBigInt(bytes);
    }
}

/** Engine-TS serializes a PKCS#1 RSA key. Its arbitrary public exponent is not admitted by Node/Bun's key importer. */
export function readRsaPrivateKey(pem: Uint8Array): RsaPrivateKey {
    const fence = '-'.repeat(5);
    const lines = new TextDecoder('utf-8', { fatal: true }).decode(pem).trim().split(/\r?\n/);
    if (lines.shift() !== `${fence}BEGIN RSA PRIVATE KEY${fence}` || lines.pop() !== `${fence}END RSA PRIVATE KEY${fence}`) throw new Error('invalid engine key');
    const base64 = lines.join('');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('invalid engine key');
    const bytes = Buffer.from(base64, 'base64');
    try {
        if (bytes.toString('base64') !== base64) throw new Error('invalid engine key');
        const root = new Der(bytes);
        const fields = new Der(root.element(0x30));
        if (!root.done || fields.integer() !== 0n) throw new Error('invalid engine key');
        const modulus = fields.integer(), publicExponent = fields.integer(), privateExponent = fields.integer();
        const p = fields.integer(), q = fields.integer();
        const exponentP = fields.integer(), exponentQ = fields.integer(), coefficient = fields.integer();
        if (!fields.done || p <= 1n || q <= 1n || p * q !== modulus || publicExponent < 3n || !(publicExponent & 1n) ||
            privateExponent <= 0n || exponentP !== privateExponent % (p - 1n) || exponentQ !== privateExponent % (q - 1n) || coefficient * q % p !== 1n) throw new Error('invalid engine key');
        return { modulus, privateExponent };
    } finally { bytes.fill(0); }
}

/** Raw RSA, matching the client's signed BigInteger byte representation (optional leading zero). */
export function decryptRsaBlock(key: RsaPrivateKey, ciphertext: Uint8Array, modulusBytes: number): Uint8Array {
    if (!ciphertext.length || ciphertext.length > modulusBytes + 1 || (ciphertext.length === modulusBytes + 1 && ciphertext[0] !== 0)) throw new Error('invalid login');
    const value = bytesToBigInt(ciphertext);
    if (value <= 0n || value >= key.modulus) throw new Error('invalid login');
    return bigIntToBytes(bigIntModPow(value, key.privateExponent, key.modulus));
}
