/** Why: the cutover is the first commit of the integration branch and runs once, so it moves the staged tree or refuses without touching it; both directions run here on a throwaway repository. */
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CutoverError, GUARD_FIXTURES, cutover } from '../../tools/cutover-377.js';
import { readManifest, sha256File, verifyManifest, writeManifest } from '../../tools/lib/manifest.js';
import type { Manifest, ManifestArtifact } from '../../tools/lib/manifest.js';

const TEMP: string[] = [];

afterAll(() => {
    for (const dir of TEMP) rmSync(dir, { recursive: true, force: true });
});

function git(root: string, args: string[]): void {
    const run = Bun.spawnSync(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'pipe' });
    if ((run.exitCode ?? 1) !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr.toString().trim()}`);
}

function put(root: string, path: string, content: string): string {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
    return sha256File(join(root, path));
}

function manifest(artifacts: ManifestArtifact[]): Manifest {
    return {
        schemaVersion: 1,
        revision: 377,
        cutover: false,
        engine: { commit: 'a'.repeat(40), archives: { config: 'b'.repeat(64), interface: 'c'.repeat(64) } },
        content: { commit: 'd'.repeat(40) },
        toolchain: { node: '24.0.0', bun: '1.4.4' },
        generators: {},
        artifacts
    };
}

/** A throwaway repository with a staged tree, a 289 destination and one 289 recording. */
function repo(files: Record<string, string>, entries: ManifestArtifact[]): string {
    const root = mkdtempSync(join(tmpdir(), 'cutover-'));
    TEMP.push(root);
    git(root, ['init', '-q']);
    for (const [path, content] of Object.entries(files)) put(root, path, content);
    for (const entry of entries) entry.sha256 = sha256File(join(root, entry.stagedPath ?? entry.path));
    writeManifest(root, manifest(entries));
    const paths = [...Object.keys(files), 'data/manifest.json'];
    git(root, ['add', '--', ...paths]);
    git(root, ['-c', 'user.name=cutover-test', '-c', 'user.email=cutover@example.test', 'commit', '-q', '-m', 'staged']);
    return root;
}

function rename(file: string): { path: string; sha256: string; kind: ManifestArtifact['kind']; qualification: ManifestArtifact['qualification'] } {
    return { path: `data/377/${file}`, sha256: '', kind: 'generated', qualification: 'pending' };
}

describe('cutover moves the staged tree', () => {
    test('git mv each artifact in place, deletes data/377 and the 289 recording, rewrites the manifest', () => {
        const root = repo(
            {
                'data/377/src/bot/data/gen.ts': '// 377 generation\n',
                'data/377/tools/nav/doors.json': '[]\n',
                'data/377/src/bot/data/cookLocations.ts': '// 377 edition\n',
                'data/377/test/x.test.ts': 'staged guard fixture\n',
                'data/377/src/x.ts': 'staged guard fixture\n',
                'src/bot/data/gen.ts': '// 289 generation\n',
                'test/io/recordings/289/old.jsonl': '{}\n'
            },
            [
                rename('src/bot/data/gen.ts'),
                { ...rename('tools/nav/doors.json'), kind: 'nav-input' },
                { ...rename('src/bot/data/cookLocations.ts'), kind: 'edition' }
            ]
        );
        expect(existsSync(join(root, 'data/377'))).toBe(true);

        const result = cutover(root);

        expect(result).toEqual(['src/bot/data/gen.ts', 'tools/nav/doors.json', 'src/bot/data/cookLocations.ts']);
        expect(readFileSync(join(root, 'src/bot/data/gen.ts'), 'utf8')).toBe('// 377 generation\n');
        expect(readFileSync(join(root, 'tools/nav/doors.json'), 'utf8')).toBe('[]\n');
        expect(existsSync(join(root, 'data/377'))).toBe(false);
        expect(existsSync(join(root, 'test/io/recordings/289'))).toBe(false);

        const after = readManifest(root);
        expect(after.cutover).toBe(true);
        expect(after.artifacts.map(a => a.path)).toEqual(['src/bot/data/gen.ts', 'tools/nav/doors.json', 'src/bot/data/cookLocations.ts']);
        expect(verifyManifest(root)).toEqual([]);
    });
    test('moves a staged out artifact onto its final path over the 289 output', () => {
        const entry: ManifestArtifact = {
            path: 'out/collision.lcnav.gz',
            sha256: '',
            kind: 'out',
            qualification: 'pending',
            stagedPath: 'data/377/out/collision.lcnav.gz'
        };
        const root = repo(
            {
                'data/377/out/collision.lcnav.gz': '377 collision pack\n',
                'out/collision.lcnav.gz': '289 collision pack\n'
            },
            [entry]
        );

        expect(cutover(root)).toEqual(['out/collision.lcnav.gz']);
        expect(readFileSync(join(root, 'out/collision.lcnav.gz'), 'utf8')).toBe('377 collision pack\n');
        expect(existsSync(join(root, 'data/377'))).toBe(false);
        expect(readManifest(root).artifacts).toEqual([
            { path: 'out/collision.lcnav.gz', sha256: sha256File(join(root, 'out/collision.lcnav.gz')), kind: 'out', qualification: 'pending' }
        ]);
        expect(verifyManifest(root)).toEqual([]);
    });


    test('the two staging guard fixtures are the only unlisted files allowed', () => {
        expect(GUARD_FIXTURES).toEqual(['data/377/test/x.test.ts', 'data/377/src/x.ts']);
        const root = repo(
            {
                'data/377/src/bot/data/gen.ts': '// 377\n',
                'data/377/test/x.test.ts': 'guard\n',
                'data/377/src/x.ts': 'guard\n'
            },
            [rename('src/bot/data/gen.ts')]
        );
        expect(cutover(root)).toEqual(['src/bot/data/gen.ts']);
        for (const fixture of GUARD_FIXTURES) expect(existsSync(join(root, fixture))).toBe(false);
    });
});

describe('cutover refuses without touching the tree', () => {
    test('an unlisted staged path', () => {
        const root = repo({ 'data/377/src/bot/data/gen.ts': '// 377\n', 'data/377/src/bot/data/extra.ts': '// no row\n' }, [
            rename('src/bot/data/gen.ts')
        ]);
        expect(() => cutover(root)).toThrow(CutoverError);
        expect(() => cutover(root)).toThrow(/data\/377\/src\/bot\/data\/extra.ts has no manifest row/);
        expect(existsSync(join(root, 'data/377/src/bot/data/extra.ts'))).toBe(true);
        expect(existsSync(join(root, 'data/377/src/bot/data/gen.ts'))).toBe(true);
        expect(existsSync(join(root, 'src/bot/data/gen.ts'))).toBe(false);
        expect(readManifest(root).cutover).toBe(false);
    });

    test('a hash mismatch', () => {
        const root = repo({ 'data/377/src/bot/data/gen.ts': '// 377\n' }, [rename('src/bot/data/gen.ts')]);
        writeFileSync(join(root, 'data/377/src/bot/data/gen.ts'), '// edited after review\n');
        expect(() => cutover(root)).toThrow(/hash differs from the manifest/);
        expect(existsSync(join(root, 'data/377/src/bot/data/gen.ts'))).toBe(true);
        expect(existsSync(join(root, 'src/bot/data/gen.ts'))).toBe(false);
        expect(readManifest(root).cutover).toBe(false);
    });

    test('a tree that is already cut over', () => {
        const root = repo({ 'data/377/src/bot/data/gen.ts': '// 377\n' }, []);
        const already = readManifest(root);
        writeManifest(root, { ...already, cutover: true });
        expect(() => cutover(root)).toThrow(/already cut over/);
    });
});

describe('cutover CLI', () => {
    test('prints the refusal and exits non-zero', () => {
        const root = repo({ 'data/377/src/bot/data/extra.ts': '// no row\n' }, []);
        const run = Bun.spawnSync(['bun', 'tools/cutover-377.ts', '--root', root], { stdout: 'pipe', stderr: 'pipe' });
        expect(run.exitCode).toBe(1);
        expect(run.stderr.toString()).toContain('has no manifest row');
        expect(run.stderr.toString()).toContain('cutover refused');
        expect(existsSync(join(root, 'data/377/src/bot/data/extra.ts'))).toBe(true);
    });

    test('a missing --root value exits with usage', () => {
        const run = Bun.spawnSync(['bun', 'tools/cutover-377.ts', '--root'], { stdout: 'pipe', stderr: 'pipe' });
        expect(run.exitCode).toBe(2);
        expect(run.stderr.toString()).toContain('usage: bun tools/cutover-377.ts');
    });
});
