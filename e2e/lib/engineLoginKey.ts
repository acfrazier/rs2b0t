import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface EngineLoginKey {
    rsae: string;
    rsan: string;
}

function decimalFromBase64Url(value: string): string {
    return BigInt(`0x${Buffer.from(value, 'base64url').toString('hex')}`).toString();
}

interface DerNode {
    tag: number;
    start: number;
    end: number;
}

function derNode(der: Uint8Array, at: number): DerNode {
    const tag = der[at];
    let length = der[at + 1];
    let start = at + 2;
    if (tag === undefined || length === undefined) throw new Error('truncated DER');
    if (length & 0x80) {
        const count = length & 0x7f;
        if (count === 0 || count > 4) throw new Error('unsupported DER length');
        length = 0;
        for (let i = 0; i < count; i++) length = length * 256 + (der[start + i] ?? 0);
        start += count;
    }
    const end = start + length;
    if (end > der.length) throw new Error('truncated DER');
    return { tag, start, end };
}

function derChildren(der: Uint8Array, parent: DerNode): DerNode[] {
    const out: DerNode[] = [];
    for (let at = parent.start; at < parent.end; ) {
        const child = derNode(der, at);
        out.push(child);
        at = child.end;
    }
    return out;
}

function derInteger(der: Uint8Array, node: DerNode): bigint {
    if (node.tag !== 0x02) throw new Error('not an INTEGER');
    return BigInt(`0x${Buffer.from(der.subarray(node.start, node.end)).toString('hex') || '0'}`);
}

/**
 * Modulus and exponent read straight from the key's DER, PKCS#8 or PKCS#1.
 * Why: Bun's BoringSSL refuses an RSA key whose public exponent is large (BAD_E_VALUE), and the stock engine key has a random 256-bit exponent.
 */
function rsaPublicFromDer(der: Uint8Array): EngineLoginKey {
    const outer = derNode(der, 0);
    let fields = derChildren(der, outer);
    // PKCS#8 wraps the PKCS#1 RSAPrivateKey in an OCTET STRING after the algorithm identifier.
    if (fields.length >= 3 && fields[2].tag === 0x04) {
        fields = derChildren(der, derNode(der, fields[2].start));
    }
    if (fields.length < 3) throw new Error('not an RSA private key');
    return { rsan: derInteger(der, fields[1]).toString(), rsae: derInteger(der, fields[2]).toString() };
}

function pemBody(pem: Buffer): Uint8Array {
    const lines = pem.toString('utf8').split(/\r?\n/);
    const body = lines.filter(line => line.trim() !== '' && !line.startsWith('-----')).join('');
    if (body === '' || lines.length === 0 || !lines[0].startsWith('-----')) throw new Error('not a PEM private key');
    return Buffer.from(body, 'base64');
}

/** Public half of `ENGINE_DIR/data/config/private.pem`, same values `deploy-local-key.sh` bakes. */
export function engineLoginKey(engineDir: string): EngineLoginKey {
    if (process.env.LOCAL_RSAE && process.env.LOCAL_RSAN) {
        return { rsae: process.env.LOCAL_RSAE, rsan: process.env.LOCAL_RSAN };
    }

    let pem: Buffer;
    try {
        pem = readFileSync(join(engineDir, 'data', 'config', 'private.pem'));
    } catch {
        throw new Error('engine login key: could not read the configured engine key');
    }

    try {
        try {
            const privateKey = createPrivateKey(pem);
            const publicKey = createPublicKey(privateKey).export({ format: 'jwk' });
            if (typeof publicKey.e !== 'string' || typeof publicKey.n !== 'string') {
                throw new Error('not an RSA key');
            }
            return { rsae: decimalFromBase64Url(publicKey.e), rsan: decimalFromBase64Url(publicKey.n) };
        } catch {
            return rsaPublicFromDer(pemBody(pem));
        }
    } catch {
        throw new Error('engine login key: the configured key is not a usable RSA private key');
    } finally {
        pem.fill(0);
    }
}
