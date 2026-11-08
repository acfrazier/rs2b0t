import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { sha256File, writeManifest } from '../../tools/lib/manifest.js';
import type { Manifest } from '../../tools/lib/manifest.js';

const TEMP: string[] = [];

function empty377(): Manifest {
    return {
        schemaVersion: 1,
        revision: 377,
        cutover: true,
        engine: { commit: null, archives: { config: null, interface: null } },
        content: { commit: null },
        toolchain: { node: null, bun: null },
        generators: {},
        artifacts: []
    };
}

describe('deployIsolatedClient collision-pack pin', () => {
    test('refuses a gzip whose raw bytes differ from the manifest pin before deployment', () => {
        const root = mkdtempSync(join(tmpdir(), 'deploy-nav-pack-'));
        TEMP.push(root);
        const engine = join(root, 'engine');
        const publicDir = join(engine, 'public');
        const compressedPath = join(root, 'out/collision.lcnav.gz');
        mkdirSync(join(root, 'data'), { recursive: true });
        mkdirSync(publicDir, { recursive: true });
        mkdirSync(join(root, 'out'), { recursive: true });
        writeFileSync(join(publicDir, 'bot.html'), '<html><script src="./bot/botclient.js"></script></html>\n');
        writeFileSync(compressedPath, gzipSync(Buffer.from('different raw nav bytes\n')));
        writeManifest(root, {
            ...empty377(),
            artifacts: [
                {
                    path: 'out/collision.lcnav.gz',
                    sha256: sha256File(compressedPath),
                    kind: 'out',
                    qualification: 'qualified',
                    uncompressedSha256: 'a'.repeat(64)
                }
            ]
        });

        const harnessUrl = pathToFileURL(join(import.meta.dir, '..', '..', 'e2e', 'lib', 'harness.js')).href;
        const source = `import { deployIsolatedClient } from ${JSON.stringify(harnessUrl)};\ndeployIsolatedClient('raw-pin-mismatch', process.env.FAKE_ENGINE_DIR, 'build');\n`;
        const result = Bun.spawnSync([process.execPath, '-e', source], {
            cwd: root,
            env: { ...process.env, FAKE_ENGINE_DIR: engine },
            stdout: 'pipe',
            stderr: 'pipe'
        });
        expect(result.exitCode).toBe(1);
        expect(result.stderr.toString()).toContain('uncompressed nav pack sha256');
        expect(existsSync(join(publicDir, 'bot-raw-pin-mismatch.html'))).toBe(false);
        expect(existsSync(join(publicDir, 'bot', 'raw-pin-mismatch'))).toBe(false);
    });
});

afterAll(() => {
    for (const root of TEMP) rmSync(root, { recursive: true, force: true });
});
