/** Why: the first commit of the integration branch. `git mv`s every staged manifest artifact onto its repo path, deletes `data/377/` and the 289 recordings, rewrites the manifest.
 *  Why it refuses first: an unlisted staged file would vanish without a trace, and a hash mismatch describes a tree nobody reviewed.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { MANIFEST_PATH, STAGED_KINDS, STAGING_ROOT, readManifest, sha256File, verifyManifest, writeManifest } from './lib/manifest.js';
import type { Manifest } from './lib/manifest.js';

/** The staging tree's own guard fixtures (test/repo/stagingInert.test.ts): deliberately poisonous,
 *  never artifacts, deleted with the tree. They are the only files a cutover may leave unlisted. */
export const GUARD_FIXTURES: readonly string[] = ['data/377/test/x.test.ts', 'data/377/src/x.ts'];

const OLD_RECORDINGS = 'test/io/recordings/289';

export class CutoverError extends Error {}

function git(root: string, args: string[]): void {
    const run = Bun.spawnSync(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'pipe' });
    if ((run.exitCode ?? 1) !== 0) {
        throw new CutoverError(`git ${args.join(' ')} failed: ${run.stderr.toString().trim()}`);
    }
}

/** Every regular file under `dir`, repo-relative and forward-slashed. */
function filesUnder(dir: string, root: string): string[] {
    const out: string[] = [];
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
        const path = join(dir, entry);
        if (!statSync(path).isFile()) continue;
        out.push(relative(root, path).split('\\').join('/'));
    }
    return out.sort();
}

/** Why the cutover cannot run, or an empty list. Nothing is written. */
function refusals(root: string, manifest: Manifest): string[] {
    const problems: string[] = [];
    if (manifest.cutover) problems.push(`already cut over (${MANIFEST_PATH} says cutover: true)`);

    const staged = new Set(
        manifest.artifacts.flatMap(artifact => [
            ...(STAGED_KINDS.includes(artifact.kind) ? [artifact.path] : []),
            ...(artifact.stagedPath === undefined ? [] : [artifact.stagedPath])
        ])
    );
    for (const artifact of manifest.artifacts) {
        if (STAGED_KINDS.includes(artifact.kind) && !artifact.path.startsWith(`${STAGING_ROOT}/`)) {
            problems.push(`${artifact.path} is listed as ${artifact.kind} but is not under ${STAGING_ROOT}/`);
        }
    }

    for (const path of filesUnder(join(root, STAGING_ROOT), root)) {
        if (GUARD_FIXTURES.includes(path) || staged.has(path)) continue;
        problems.push(`${path} has no manifest row`);
    }

    for (const path of staged) {
        if (!existsSync(join(root, path))) {
            problems.push(`${path} is listed but missing`);
            continue;
        }
        const expected = manifest.artifacts.find(a => a.path === path || a.stagedPath === path)?.sha256;
        const actual = sha256File(join(root, path));
        if (expected !== actual) problems.push(`${path} hash differs from the manifest (${actual.slice(0, 12)}… vs ${expected?.slice(0, 12)}…)`);
    }

    return problems;
}

/**
 * Perform the cutover in `root`; returns the repo paths now in place.
 * Refuses (throws `CutoverError`) with every problem listed, before touching the tree.
 */
export function cutover(root = process.cwd()): string[] {
    const manifest = readManifest(root);
    const problems = refusals(root, manifest);
    if (problems.length > 0) {
        throw new CutoverError(`cutover refused:\n  ${problems.join('\n  ')}`);
    }

    const moved: string[] = [];
    for (const artifact of manifest.artifacts) {
        if (STAGED_KINDS.includes(artifact.kind)) {
            const to = relative(STAGING_ROOT, artifact.path);
            mkdirSync(dirname(join(root, to)), { recursive: true });
            git(root, ['mv', '-f', '--', artifact.path, to]);
            moved.push(to);
        } else if (artifact.stagedPath !== undefined) {
            const from = join(root, artifact.stagedPath);
            const to = join(root, artifact.path);
            mkdirSync(dirname(to), { recursive: true });
            renameSync(from, to);
            moved.push(artifact.path);
        }
    }

    for (const path of GUARD_FIXTURES) {
        if (existsSync(join(root, path))) git(root, ['rm', '-f', '--quiet', '--ignore-unmatch', '--', path]);
    }
    rmSync(join(root, STAGING_ROOT), { recursive: true, force: true });

    if (existsSync(join(root, OLD_RECORDINGS))) {
        git(root, ['rm', '-r', '-f', '--quiet', '--ignore-unmatch', '--', OLD_RECORDINGS]);
        rmSync(join(root, OLD_RECORDINGS), { recursive: true, force: true });
    }

    const rewritten: Manifest = {
        ...manifest,
        cutover: true,
        artifacts: manifest.artifacts.map(artifact => {
            if (artifact.path.startsWith(`${STAGING_ROOT}/`)) {
                return { ...artifact, path: relative(STAGING_ROOT, artifact.path) };
            }
            if (artifact.stagedPath !== undefined) {
                const { stagedPath: _stagedPath, ...finalArtifact } = artifact;
                return finalArtifact;
            }
            return artifact;
        })
    };
    writeManifest(root, rewritten);

    const broken = verifyManifest(root);
    if (broken.length > 0) throw new CutoverError(`cutover left an inconsistent tree:\n  ${broken.join('\n  ')}`);

    return moved;
}

if (import.meta.main) {
    const rootFlag = process.argv.indexOf('--root');
    const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];
    if (root === undefined) {
        console.error('usage: bun tools/cutover-377.ts [--root <dir>]');
        process.exit(2);
    }
    try {
        const moved = cutover(root);
        for (const path of moved) console.log(`moved ${path}`);
        console.log(`ok: cut over ${moved.length} staged artifact(s); ${STAGING_ROOT}/ removed`);
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}
