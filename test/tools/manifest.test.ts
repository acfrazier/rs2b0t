/** The manifest is the only record tying a committed artifact to the generator that made it
 *  (pitfall 10): output integrity and generator staleness must fail loudly, not pass on a crash.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { ManifestError, engineArchiveProblems, parseManifest, readManifest, sha256File, verifyManifest, verifyManifestReport, writeManifest } from '../../tools/lib/manifest.js';
import type { Manifest } from '../../tools/lib/manifest.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function empty(): Manifest {
    return {
        schemaVersion: 1,
        revision: 289,
        cutover: false,
        engine: { commit: null, archives: { config: null, interface: null } },
        content: { commit: null },
        toolchain: { node: null, bun: null },
        generators: {},
        artifacts: []
    };
}

const TEMP: string[] = [];
function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'manifest-'));
    TEMP.push(dir);
    return dir;
}

function put(root: string, path: string, content: string): string {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
    return sha256File(join(root, path));
}

afterAll(() => {
    for (const dir of TEMP) rmSync(dir, { recursive: true, force: true });
});

describe('manifest schema', () => {
    test('a staged artifact before the cutover is valid', () => {
        const root = tempDir();
        const hash = put(root, 'data/377/src/bot/data/x.ts', 'export const x = 1;\n');
        mkdirSync(join(root, 'data/377'), { recursive: true });
        const manifest: Manifest = {
            ...empty(),
            artifacts: [{ path: 'data/377/src/bot/data/x.ts', sha256: hash, kind: 'generated', qualification: 'pending' }]
        };
        expect(() => parseManifest(manifest)).not.toThrow();
        writeManifest(root, manifest);
        expect(verifyManifest(root)).toEqual([]);
    });

    test('unknown keys, duplicate paths, bad hashes and bad enums are refused', () => {
        expect(() => parseManifest({ ...empty(), extra: 1 })).toThrow(ManifestError);
        expect(() => parseManifest({ ...empty(), schemaVersion: 2 })).toThrow(ManifestError);
        expect(() => parseManifest({ ...empty(), revision: 0 })).toThrow(ManifestError);
        expect(() =>
            parseManifest({
                ...empty(),
                artifacts: [
                    { path: 'data/377/a.ts', sha256: HASH_A, kind: 'generated', qualification: 'pending' },
                    { path: 'data/377/a.ts', sha256: HASH_B, kind: 'generated', qualification: 'pending' }
                ]
            })
        ).toThrow(/duplicate artifact path/);
        expect(() => parseManifest({ ...empty(), artifacts: [{ path: 'data/377/a.ts', sha256: 'nope', kind: 'generated', qualification: 'pending' }] })).toThrow(
            /sha256/
        );
        expect(() =>
            parseManifest({ ...empty(), artifacts: [{ path: 'data/377/a.ts', sha256: HASH_A, kind: 'mystery', qualification: 'pending' }] })
        ).toThrow(/kind/);
        expect(() => parseManifest({ ...empty(), artifacts: [{ path: '../a.ts', sha256: HASH_A, kind: 'generated', qualification: 'pending' }] })).toThrow(
            /traversal/
        );
    });

    test('a generated artifact must be staged before the cutover and unstaged after it', () => {
        expect(() =>
            parseManifest({ ...empty(), artifacts: [{ path: 'src/bot/data/x.ts', sha256: HASH_A, kind: 'generated', qualification: 'pending' }] })
        ).toThrow(/not staged under data\/377/);
        expect(() =>
            parseManifest({
                ...empty(),
                cutover: true,
                artifacts: [{ path: 'data/377/src/bot/data/x.ts', sha256: HASH_A, kind: 'generated', qualification: 'pending' }]
            })
        ).toThrow(/after the cutover/);
    });

    test('an out artifact may live outside the staging tree', () => {
        expect(() =>
            parseManifest({ ...empty(), artifacts: [{ path: 'out/collision.lcnav.gz', sha256: HASH_A, kind: 'out', qualification: 'pending' }] })
        ).not.toThrow();
    });
    test('an out artifact may point at a staged source while keeping its final path', () => {
        expect(() =>
            parseManifest({
                ...empty(),
                artifacts: [
                    {
                        path: 'out/collision.lcnav.gz',
                        sha256: HASH_A,
                        kind: 'out',
                        qualification: 'pending',
                        stagedPath: 'data/377/out/collision.lcnav.gz'
                    }
                ]
            })
        ).not.toThrow();
        expect(() =>
            parseManifest({
                ...empty(),
                artifacts: [
                    {
                        path: 'data/377/src/bot/data/x.ts',
                        sha256: HASH_A,
                        kind: 'generated',
                        qualification: 'pending',
                        stagedPath: 'data/377/out/collision.lcnav.gz'
                    }
                ]
            })
        ).toThrow(/only valid for an out artifact/);
    });


});

describe('manifest verify', () => {
    test('a changed artifact fails', () => {
        const root = tempDir();
        const hash = put(root, 'data/377/a.ts', 'one\n');
        writeManifest(root, {
            ...empty(),
            artifacts: [{ path: 'data/377/a.ts', sha256: hash, kind: 'generated', qualification: 'pending' }]
        });
        put(root, 'data/377/a.ts', 'two\n');
        expect(verifyManifest(root)).toEqual([expect.stringContaining("artifact 'data/377/a.ts' changed")]);
    });

    test('a changed or missing generator fails', () => {
        const root = tempDir();
        const hash = put(root, 'tools/gen-x.ts', 'export {};\n');
        mkdirSync(join(root, 'data/377'), { recursive: true });
        writeManifest(root, { ...empty(), generators: { 'tools/gen-x.ts': hash } });
        expect(verifyManifest(root)).toEqual([]);

        put(root, 'tools/gen-x.ts', 'export const y = 1;\n');
        expect(verifyManifest(root)).toEqual([expect.stringContaining('generator \'tools/gen-x.ts\' changed')]);

        rmSync(join(root, 'tools/gen-x.ts'));
        expect(verifyManifest(root)).toEqual([expect.stringContaining("generator 'tools/gen-x.ts' is listed but missing")]);
    });

    test('a missing artifact fails', () => {
        const root = tempDir();
        mkdirSync(join(root, 'data/377'), { recursive: true });
        writeManifest(root, {
            ...empty(),
            artifacts: [{ path: 'data/377/gone.ts', sha256: HASH_A, kind: 'generated', qualification: 'pending' }]
        });
        expect(verifyManifest(root)).toEqual([expect.stringContaining('is listed but missing')]);
    });

    test('a missing out artifact is a printed skip, not a failure', () => {
        const root = tempDir();
        mkdirSync(join(root, 'data'), { recursive: true });
        writeManifest(root, {
            ...empty(),
            artifacts: [{ path: 'out/basemap.x.png', sha256: HASH_A, kind: 'out', qualification: 'pending' }]
        });
        // Untracked by design: no problem, the CLI prints the skip line.
        expect(verifyManifest(root)).toEqual([]);
        expect(verifyManifestReport(root).skipped).toEqual([
            'SKIP: out/basemap.x.png: out artifact is not tracked; hash verified only when the file is present'
        ]);
    });

    test('a present out artifact is still hash-checked', () => {
        const root = tempDir();
        mkdirSync(join(root, 'data'), { recursive: true });
        const hash = put(root, 'out/basemap.x.png', 'png-bytes\n');
        writeManifest(root, {
            ...empty(),
            artifacts: [{ path: 'out/basemap.x.png', sha256: hash, kind: 'out', qualification: 'pending' }]
        });
        expect(verifyManifestReport(root)).toEqual({ problems: [], skipped: [] });

        put(root, 'out/basemap.x.png', 'other-bytes\n');
        const report = verifyManifestReport(root);
        expect(report.problems).toEqual([expect.stringContaining("artifact 'out/basemap.x.png' changed")]);
        expect(report.skipped).toEqual([]);
    });
    test('a staged out artifact verifies its staged bytes instead of a different live revision', () => {
        const root = tempDir();
        const staged = 'data/377/out/collision.lcnav.gz';
        const output = 'out/collision.lcnav.gz';
        const hash = put(root, staged, '377 collision pack\n');
        put(root, output, '289 collision pack\n');
        writeManifest(root, {
            ...empty(),
            artifacts: [{ path: output, sha256: hash, kind: 'out', qualification: 'pending', stagedPath: staged }]
        });
        expect(verifyManifestReport(root)).toEqual({ problems: [], skipped: [] });

        put(root, staged, 'different staged pack\n');
        expect(verifyManifest(root)).toEqual([expect.stringContaining("artifact 'out/collision.lcnav.gz' changed")]);
    });
    test('a missing staged out artifact is a printed skip, not a failure', () => {
        const root = tempDir();
        mkdirSync(join(root, 'data/377'), { recursive: true });
        writeManifest(root, {
            ...empty(),
            artifacts: [{ path: 'out/collision.lcnav.gz', sha256: 'a'.repeat(64), kind: 'out', qualification: 'pending', stagedPath: 'data/377/out/collision.lcnav.gz' }]
        });
        const report = verifyManifestReport(root);
        expect(report.problems).toEqual([]);
        expect(report.skipped).toEqual([expect.stringContaining('staged at data/377/out/collision.lcnav.gz')]);
    });

    test('the staging tree must agree with cutover', () => {
        const root = tempDir();
        mkdirSync(join(root, 'data/377'), { recursive: true });
        writeManifest(root, { ...empty(), cutover: true });
        expect(verifyManifest(root)).toEqual([expect.stringContaining('still exists after the cutover')]);
    });

    test('the engine archives must match the recorded hashes', () => {
        const root = tempDir();
        const engine = join(root, 'engine');
        mkdirSync(join(engine, 'data/pack/client'), { recursive: true });
        mkdirSync(join(root, 'data/377'), { recursive: true });
        const hash = put(root, 'engine-data-config', 'config-bytes\n');
        put(engine, 'data/pack/client/config', 'config-bytes\n');
        put(engine, 'data/pack/client/interface', 'interface-bytes\n');
        writeManifest(root, { ...empty(), engine: { commit: null, archives: { config: hash, interface: null } } });
        expect(engineArchiveProblems(root, engine)).toEqual([]);

        put(engine, 'data/pack/client/config', 'another-config\n');
        expect(engineArchiveProblems(root, engine)).toEqual([expect.stringContaining("engine 'config' is")]);

        rmSync(join(engine, 'data/pack/client/config'));
        expect(engineArchiveProblems(root, engine)).toEqual([expect.stringContaining('engine archive')]);
    });

    test('the committed manifest parses and verifies', () => {
        expect(verifyManifest()).toEqual([]);
        expect(readManifest().schemaVersion).toBe(1);
    });
});
