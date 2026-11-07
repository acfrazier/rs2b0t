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
        const privateKey = createPrivateKey(pem);
        const publicKey = createPublicKey(privateKey).export({ format: 'jwk' });
        if (typeof publicKey.e !== 'string' || typeof publicKey.n !== 'string') {
            throw new Error('not an RSA key');
        }
        return { rsae: decimalFromBase64Url(publicKey.e), rsan: decimalFromBase64Url(publicKey.n) };
    } catch {
        throw new Error('engine login key: the configured key is not a usable RSA private key');
    } finally {
        pem.fill(0);
    }
}
