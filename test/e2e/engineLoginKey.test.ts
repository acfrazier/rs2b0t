import { describe, expect, test } from 'bun:test';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { engineLoginKey } from '../../e2e/lib/engineLoginKey.js';

const ENGINE = process.env.ENGINE_DIR ?? join(homedir(), 'code', 'rs2b2t-engine');
const PEM = join(ENGINE, 'data', 'config', 'private.pem');

function decimal(value: string | undefined): string {
    if (!value) throw new Error('synthetic RSA public key integer is missing');
    return BigInt(`0x${Buffer.from(value, 'base64url').toString('hex')}`).toString();
}

describe('engineLoginKey', () => {
    test('derives only public RSA parameters from an in-place private-key read', () => {
        const engineDir = mkdtempSync(join(tmpdir(), 'frtap-key-test-'));
        try {
            const configDir = join(engineDir, 'data', 'config');
            mkdirSync(configDir, { recursive: true });
            const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
            writeFileSync(join(configDir, 'private.pem'), privateKey.export({ format: 'pem', type: 'pkcs8' }));
            const expected = createPublicKey(privateKey).export({ format: 'jwk' });
            const key = engineLoginKey(engineDir);
            expect(key).toEqual({ rsae: decimal(expected.e), rsan: decimal(expected.n) });
            expect(engineLoginKey(engineDir)).toEqual(key);
        } finally {
            rmSync(engineDir, { recursive: true, force: true });
        }
    });

    test('redacts the configured path when the engine key cannot be read', () => {
        const engineDir = mkdtempSync(join(tmpdir(), 'frtap-key-missing-test-'));
        try {
            let message = '';
            try {
                engineLoginKey(engineDir);
            } catch (error) {
                message = error instanceof Error ? error.message : String(error);
            }
            expect(message).toBe('engine login key: could not read the configured engine key');
            expect(message).not.toContain(engineDir);
        } finally {
            rmSync(engineDir, { recursive: true, force: true });
        }
    });
});

describe.skipIf(!existsSync(PEM))('engineLoginKey on configured engine', () => {
    test('reads decimal rsae and rsan from private.pem', () => {
        const key = engineLoginKey(ENGINE);
        expect(/^\d+$/.test(key.rsae)).toBe(true);
        expect(/^\d+$/.test(key.rsan)).toBe(true);
        expect(key.rsan.length).toBeGreaterThan(100);
        expect(engineLoginKey(ENGINE)).toEqual(key);
    });
});
