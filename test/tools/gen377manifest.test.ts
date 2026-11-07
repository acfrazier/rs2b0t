/** The P4a manifest writer: rows named by a run are replaced, other slices' rows survive, and an
 *  `out/` row hashes the file in the chosen output dir while keeping the repo's `out/` path.
 *  Why: a byte-identity run bakes the basemap into a scratch dir, so the hash source and the
 *  recorded path must not be the same string (a bug this test keeps from returning).
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { readManifest, sha256File, writeManifest } from '../../tools/lib/manifest.js';
import type { Manifest } from '../../tools/lib/manifest.js';

const SCRIPT = join(import.meta.dir, '..', '..', 'tools', 'gen-377-manifest.ts');
const HASH_A = 'a'.repeat(64);

const TEMP: string[] = [];
function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'gen377manifest-'));
    TEMP.push(dir);
    return dir;
}

function put(root: string, path: string, content: string): string {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
    return sha256File(join(root, path));
}

function seed(root: string, manifest: Manifest): void {
    mkdirSync(join(root, 'data'), { recursive: true });
    writeManifest(root, manifest);
}

function emptyManifest(): Manifest {
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

function run(root: string, args: string[]): { code: number; out: string } {
    const result = Bun.spawnSync([process.execPath, SCRIPT, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
    return { code: result.exitCode ?? 1, out: `${result.stdout.toString()}${result.stderr.toString()}` };
}

afterAll(() => {
    for (const dir of TEMP) rmSync(dir, { recursive: true, force: true });
});

describe('gen-377-manifest', () => {
    test('hashes an out artifact from the bake dir while recording its repo out/ path', () => {
        const root = tempDir();
        seed(root, emptyManifest());
        const generatedHash = put(root, 'data/377/src/bot/data/itemdb.ts', 'export const ITEM_DB = [];\n');
        put(root, 'tools/gen-itemdb.ts', 'export {};\n');
        const outHash = put(root, 'scratch/worldmap-basemap.abc.png', 'png-bytes\n');

        const result = run(root, [
            '--revision',
            '377',
            '--out-dir',
            'scratch',
            '--generator',
            'tools/gen-itemdb.ts',
            '--artifact',
            'data/377/src/bot/data/itemdb.ts=generated'
        ]);
        expect(result.code).toBe(0);

        const manifest = readManifest(root);
        expect(manifest.revision).toBe(377);
        expect(manifest.generators['tools/gen-itemdb.ts']).toBe(sha256File(join(root, 'tools/gen-itemdb.ts')));
        expect(manifest.artifacts).toEqual([
            { path: 'data/377/src/bot/data/itemdb.ts', sha256: generatedHash, kind: 'generated', qualification: 'pending' },
            { path: 'out/worldmap-basemap.abc.png', sha256: outHash, kind: 'out', qualification: 'pending' }
        ]);
        expect(readFileSync(join(root, 'data/manifest.json'), 'utf8').endsWith('\n')).toBe(true);

        // A second run replaces the same out row instead of appending a duplicate path.
        const rerunHash = put(root, 'scratch/worldmap-basemap.abc.png', 'new-png-bytes\n');
        const rerun = run(root, [
            '--revision',
            '377',
            '--out-dir',
            'scratch',
            '--generator',
            'tools/gen-itemdb.ts',
            '--artifact',
            'data/377/src/bot/data/itemdb.ts=generated'
        ]);
        expect(rerun.code).toBe(0);
        expect(readManifest(root).artifacts).toEqual([
            { path: 'data/377/src/bot/data/itemdb.ts', sha256: generatedHash, kind: 'generated', qualification: 'pending' },
            { path: 'out/worldmap-basemap.abc.png', sha256: rerunHash, kind: 'out', qualification: 'pending' }
        ]);
    });
    test('records a staged out artifact at its final path and hashes the staged source', () => {
        const root = tempDir();
        seed(root, emptyManifest());
        const stagedPath = 'data/377/out/collision.lcnav.gz';
        const stagedHash = put(root, stagedPath, '377 collision pack\n');
        put(root, 'out/collision.lcnav.gz', '289 collision pack\n');

        const result = run(root, ['--revision', '377', '--artifact', `${stagedPath}=out`]);
        expect(result.code).toBe(0);
        expect(readManifest(root).artifacts).toEqual([
            {
                path: 'out/collision.lcnav.gz',
                sha256: stagedHash,
                kind: 'out',
                qualification: 'pending',
                stagedPath
            }
        ]);
    });


    test('rows for another slice survive a run that does not name them', () => {
        const root = tempDir();
        const navHash = put(root, 'data/377/src/bot/event/webwalk/data/doors.json', '{}\n');
        const staleHash = put(root, 'data/377/src/bot/data/itemdb.ts', 'old\n');
        seed(root, {
            ...emptyManifest(),
            artifacts: [
                { path: 'data/377/src/bot/event/webwalk/data/doors.json', sha256: navHash, kind: 'nav-input', qualification: 'pending' },
                { path: 'data/377/src/bot/data/itemdb.ts', sha256: staleHash, kind: 'generated', qualification: 'pending' }
            ]
        });
        const freshHash = put(root, 'data/377/src/bot/data/itemdb.ts', 'new\n');
        put(root, 'tools/gen-itemdb.ts', 'export {};\n');
        mkdirSync(join(root, 'out'), { recursive: true });

        const result = run(root, [
            '--revision',
            '377',
            '--generator',
            'tools/gen-itemdb.ts',
            '--artifact',
            'data/377/src/bot/data/itemdb.ts=generated'
        ]);
        expect(result.code).toBe(0);

        const artifacts = readManifest(root).artifacts;
        expect(artifacts.find(a => a.path.endsWith('doors.json'))).toEqual({
            path: 'data/377/src/bot/event/webwalk/data/doors.json',
            sha256: navHash,
            kind: 'nav-input',
            qualification: 'pending'
        });
        expect(artifacts.find(a => a.path.endsWith('itemdb.ts'))?.sha256).toBe(freshHash);
    });
    test('uses a generated seed manifest to resolve an invalid merge result', () => {
        const root = tempDir();
        const seedRoot = tempDir();
        const carriedArtifact = {
            path: 'data/377/src/bot/data/p4a.ts',
            sha256: HASH_A,
            kind: 'generated' as const,
            qualification: 'pending' as const
        };
        seed(seedRoot, { ...emptyManifest(), artifacts: [carriedArtifact] });
        mkdirSync(join(root, 'data'), { recursive: true });
        writeFileSync(join(root, 'data/manifest.json'), '<<<<<<< HEAD\n');
        mkdirSync(join(root, 'out'), { recursive: true });

        const result = run(root, ['--revision', '377', '--seed-manifest', join(seedRoot, 'data/manifest.json')]);
        expect(result.code).toBe(0);
        expect(readManifest(root).artifacts).toEqual([carriedArtifact]);
    });


    test('a missing artifact source fails the run', () => {
        const root = tempDir();
        seed(root, emptyManifest());
        put(root, 'tools/gen-itemdb.ts', 'export {};\n');
        mkdirSync(join(root, 'out'), { recursive: true });
        const result = run(root, ['--revision', '377', '--generator', 'tools/gen-itemdb.ts', '--artifact', 'data/377/src/bot/data/gone.ts=generated']);
        expect(result.code).not.toBe(0);
        expect(result.out).toContain('artifact source missing');
    });

    test('an invalid kind is refused before writing', () => {
        const root = tempDir();
        seed(root, emptyManifest());
        put(root, 'tools/gen-itemdb.ts', 'export {};\n');
        const result = run(root, ['--revision', '377', '--generator', 'tools/gen-itemdb.ts', '--artifact', 'data/377/x.ts=mystery']);
        expect(result.code).not.toBe(0);
        expect(result.out).toContain("unknown kind 'mystery'");
    });
});
