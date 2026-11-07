/** `data/manifest.json`: what data the tree carries and the hash of every artifact and generator; staged kinds live under `data/377/` until the cutover, `out` and `recording` live at their repo path throughout.
 *  Why: a generated module that lags its generator passes every test that reads it (`54aeed35`, `d721cfa4`); the manifest is the only record tying an artifact to its generator, engine and content commit.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export const MANIFEST_PATH = 'data/manifest.json';
export const STAGING_ROOT = 'data/377';

export type ArtifactKind = 'generated' | 'edition' | 'nav-input' | 'recording' | 'out';
export type Qualification = 'pending' | 'offline' | 'qualified';

/** Kinds that are staged under `data/377/` before the cutover. */
export const STAGED_KINDS: readonly ArtifactKind[] = ['generated', 'edition', 'nav-input'];

export const ARTIFACT_KINDS: readonly ArtifactKind[] = ['generated', 'edition', 'nav-input', 'recording', 'out'];
export const QUALIFICATIONS: readonly Qualification[] = ['pending', 'offline', 'qualified'];

export interface ManifestArtifact {
    /** Repo-relative final path; staged kinds carry a `data/377/` path until the cutover. */
    path: string;
    sha256: string;
    kind: ArtifactKind;
    qualification: Qualification;
    /** For an `out` artifact staged before cutover, its temporary source path under `data/377/`. */
    stagedPath?: string;
}

export interface Manifest {
    schemaVersion: 1;
    /** The revision the data is for; 289 until P4a stages the 377 artifacts. */
    revision: number;
    /** False while artifacts sit under `data/377/`, true once `tools/cutover-377.ts` has run. */
    cutover: boolean;
    engine: {
        commit: string | null;
        /** sha256 of the engine's `data/pack/client/{config,interface}`. */
        archives: { config: string | null; interface: string | null };
    };
    content: { commit: string | null };
    toolchain: { node: string | null; bun: string | null };
    /** Generator script repo path -> sha256, so editing one without regenerating fails verify. */
    generators: Record<string, string>;
    artifacts: ManifestArtifact[];
}

/** A manifest or tree problem; `message` is already prefixed with the file and location. */
export class ManifestError extends Error {}

const SHA256_RE = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const ROOT_KEYS = ['schemaVersion', 'revision', 'cutover', 'engine', 'content', 'toolchain', 'generators', 'artifacts'];
const ENGINE_KEYS = ['commit', 'archives'];
const ARCHIVE_KEYS = ['config', 'interface'];
const CONTENT_KEYS = ['commit'];
const TOOLCHAIN_KEYS = ['node', 'bun'];
const ARTIFACT_KEYS = ['path', 'sha256', 'kind', 'qualification', 'stagedPath'];

function fail(where: string, message: string): never {
    throw new ManifestError(`${MANIFEST_PATH}: ${where}: ${message}`);
}

/** Validate an object shape once at the boundary, then read a typed record; never assert blind. */
function asObject(value: unknown, where: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(where, 'expected an object');
    return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) fail(where, `unknown key '${key}'`);
    }
}

function requireKeys(value: Record<string, unknown>, required: readonly string[], where: string): void {
    for (const key of required) {
        if (!(key in value)) fail(where, `missing key '${key}'`);
    }
}

function parseHash(value: unknown, where: string): string | null {
    if (value === null) return null;
    if (typeof value !== 'string' || !SHA256_RE.test(value)) fail(where, 'expected a lowercase sha256 or null');
    return value;
}

function parseCommit(value: unknown, where: string): string | null {
    if (value === null) return null;
    if (typeof value !== 'string' || !COMMIT_RE.test(value)) fail(where, 'expected a lowercase 40-hex commit or null');
    return value;
}

function parseText(value: unknown, where: string): string | null {
    if (value === null) return null;
    if (typeof value !== 'string' || value.trim() === '') fail(where, 'expected a non-empty string or null');
    return value;
}

/** Repo-relative, forward slashes, no traversal; the value a hash is checked against. */
export function checkRepoPath(value: unknown, where: string): string {
    if (typeof value !== 'string' || value === '') fail(where, 'expected a non-empty repo-relative path');
    if (isAbsolute(value) || value.startsWith('/') || value.includes('\\')) fail(where, `'${value}' is not repo-relative`);
    const parts = value.split('/');
    if (parts.includes('..') || parts.includes('') || parts.includes('.')) fail(where, `'${value}' has a traversal segment`);
    return value;
}

function parseArtifact(value: unknown, index: number, cutover: boolean, seen: Set<string>): ManifestArtifact {
    const where = `artifacts[${index}]`;
    const entry = asObject(value, where);
    onlyKeys(entry, ARTIFACT_KEYS, where);
    requireKeys(entry, ['path', 'sha256', 'kind', 'qualification'], where);

    const path = checkRepoPath(entry.path, `${where}.path`);
    if (seen.has(path)) fail(where, `duplicate artifact path '${path}'`);
    seen.add(path);

    const sha256 = entry.sha256;
    if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) fail(`${where}.sha256`, 'expected a lowercase sha256');

    const kind = entry.kind;
    if (!ARTIFACT_KINDS.includes(kind as ArtifactKind)) fail(`${where}.kind`, `expected one of ${ARTIFACT_KINDS.join(', ')}`);

    const qualification = entry.qualification;
    if (!QUALIFICATIONS.includes(qualification as Qualification)) {
        fail(`${where}.qualification`, `expected one of ${QUALIFICATIONS.join(', ')}`);
    }

    const staged = path.startsWith(`${STAGING_ROOT}/`);
    if (!cutover && STAGED_KINDS.includes(kind as ArtifactKind) && !staged) {
        fail(`${where}.path`, `'${path}' is a ${String(kind)} artifact but is not staged under ${STAGING_ROOT}/`);
    }
    if (cutover && staged) fail(`${where}.path`, `'${path}' still points into ${STAGING_ROOT}/ after the cutover`);

    let stagedPath: string | undefined;
    if (entry.stagedPath !== undefined) {
        stagedPath = checkRepoPath(entry.stagedPath, `${where}.stagedPath`);
        if (kind !== 'out') fail(`${where}.stagedPath`, 'is only valid for an out artifact');
        if (cutover) fail(`${where}.stagedPath`, `still points into ${STAGING_ROOT}/ after the cutover`);
        if (!path.startsWith('out/') || !stagedPath.startsWith(`${STAGING_ROOT}/out/`)) {
            fail(`${where}.stagedPath`, 'must stage an out artifact under data/377/out/ while keeping its final out/ path');
        }
        if (seen.has(stagedPath)) fail(where, `duplicate staged artifact path '${stagedPath}'`);
        seen.add(stagedPath);
    }

    return {
        path,
        sha256,
        kind: kind as ArtifactKind,
        qualification: qualification as Qualification,
        ...(stagedPath === undefined ? {} : { stagedPath })
    };
}

/** Validate a parsed manifest; throws `ManifestError` with the field at fault. */
export function parseManifest(raw: unknown): Manifest {
    const root = asObject(raw, 'root');
    onlyKeys(root, ROOT_KEYS, 'root');
    requireKeys(root, ROOT_KEYS, 'root');

    const schemaVersion = root.schemaVersion;
    if (schemaVersion !== 1) fail('schemaVersion', 'expected 1');

    const revision = root.revision;
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision <= 0) fail('revision', 'expected a positive integer');

    const cutover = root.cutover;
    if (typeof cutover !== 'boolean') fail('cutover', 'expected a boolean');

    const engine = asObject(root.engine, 'engine');
    onlyKeys(engine, ENGINE_KEYS, 'engine');
    requireKeys(engine, ENGINE_KEYS, 'engine');
    const engineCommit = parseCommit(engine.commit, 'engine.commit');
    const archives = asObject(engine.archives, 'engine.archives');
    onlyKeys(archives, ARCHIVE_KEYS, 'engine.archives');
    requireKeys(archives, ARCHIVE_KEYS, 'engine.archives');

    const content = asObject(root.content, 'content');
    onlyKeys(content, CONTENT_KEYS, 'content');
    requireKeys(content, CONTENT_KEYS, 'content');

    const toolchain = asObject(root.toolchain, 'toolchain');
    onlyKeys(toolchain, TOOLCHAIN_KEYS, 'toolchain');
    requireKeys(toolchain, TOOLCHAIN_KEYS, 'toolchain');

    const rawGenerators = asObject(root.generators, 'generators');
    const generators: Record<string, string> = {};
    for (const [path, hash] of Object.entries(rawGenerators)) {
        checkRepoPath(path, `generators['${path}']`);
        if (typeof hash !== 'string' || !SHA256_RE.test(hash)) fail(`generators['${path}']`, 'expected a lowercase sha256');
        generators[path] = hash;
    }

    if (!Array.isArray(root.artifacts)) fail('artifacts', 'expected an array');
    const seen = new Set<string>();
    const artifacts = root.artifacts.map((entry, i) => parseArtifact(entry, i, cutover, seen));

    return {
        schemaVersion: 1,
        revision,
        cutover,
        engine: {
            commit: engineCommit,
            archives: {
                config: parseHash(archives.config, 'engine.archives.config'),
                interface: parseHash(archives.interface, 'engine.archives.interface')
            }
        },
        content: { commit: parseCommit(content.commit, 'content.commit') },
        toolchain: {
            node: parseText(toolchain.node, 'toolchain.node'),
            bun: parseText(toolchain.bun, 'toolchain.bun')
        },
        generators,
        artifacts
    };
}

export function readManifest(root = process.cwd()): Manifest {
    return parseManifest(JSON.parse(readFileSync(join(root, MANIFEST_PATH), 'utf8')));
}

/** Canonical bytes: two-space JSON, stable key order, trailing newline. */
export function writeManifest(root: string, manifest: Manifest): void {
    writeFileSync(join(root, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function sha256File(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Why: a client whose config decoder matches another engine's `config`/`interface` archives desyncs every later entry (pitfall 7); an unrecorded hash is not compared until P4a records both. */
export function engineArchiveProblems(root: string, engineDir: string): string[] {
    const manifest = readManifest(root);
    const problems: string[] = [];
    for (const name of ['config', 'interface'] as const) {
        const expected = manifest.engine.archives[name];
        if (expected === null) continue;
        const path = join(engineDir, 'data', 'pack', 'client', name);
        if (!existsSync(path)) {
            problems.push(`engine archive '${path}' is missing`);
            continue;
        }
        const actual = sha256File(path);
        if (actual !== expected) problems.push(`engine '${name}' is ${actual.slice(0, 12)}…, the manifest pins ${expected.slice(0, 12)}…`);
    }
    return problems;
}

/** Why: an `out` artifact is untracked by design, so verify hashes its `stagedPath` source until cutover even when a live `out/` file is present. */
export interface VerifyReport {
    problems: string[];
    skipped: string[];
}

/** Every problem that makes the manifest or the tree it describes wrong, in a stable order; empty means artifacts, generators and the staging tree all agree with it. */
export function verifyManifestReport(root = process.cwd()): VerifyReport {
    let manifest: Manifest;
    try {
        manifest = readManifest(root);
    } catch (err) {
        return { problems: [(err as Error).message], skipped: [] };
    }

    const problems: string[] = [];
    const skipped: string[] = [];
    for (const [path, expected] of Object.entries(manifest.generators).sort(([a], [b]) => a.localeCompare(b))) {
        const abs = join(root, path);
        if (!existsSync(abs)) {
            problems.push(`generator '${path}' is listed but missing`);
            continue;
        }
        const actual = sha256File(abs);
        if (actual !== expected) problems.push(`generator '${path}' changed: manifest ${expected.slice(0, 12)}…, tree ${actual.slice(0, 12)}…`);
    }

    for (const artifact of manifest.artifacts) {
        const checkedPath = artifact.stagedPath ?? artifact.path;
        const abs = join(root, checkedPath);
        if (!existsSync(abs)) {
            if (artifact.kind === 'out') {
                const where = artifact.stagedPath === undefined ? '' : ` (staged at ${artifact.stagedPath})`;
                skipped.push(`SKIP: ${artifact.path}: out artifact is not tracked${where}; hash verified only when the file is present`);
            } else if (artifact.stagedPath !== undefined) {
                problems.push(`artifact '${artifact.path}' staged at '${artifact.stagedPath}' is missing`);
            } else {
                problems.push(`artifact '${artifact.path}' is listed but missing`);
            }
            continue;
        }
        const actual = sha256File(abs);
        if (actual !== artifact.sha256) {
            problems.push(`artifact '${artifact.path}' changed: manifest ${artifact.sha256.slice(0, 12)}…, tree ${actual.slice(0, 12)}…`);
        }
    }

    const stagingExists = existsSync(join(root, STAGING_ROOT));
    if (manifest.cutover && stagingExists) problems.push(`${STAGING_ROOT}/ still exists after the cutover`);
    if (!manifest.cutover && !stagingExists && manifest.artifacts.some(a => a.stagedPath !== undefined || (a.kind !== 'out' && a.kind !== 'recording'))) {
        problems.push(`${STAGING_ROOT}/ is missing while staged artifacts are listed`);
    }

    return { problems, skipped };
}

/** The problems only; the skipped `out` rows are the CLI's concern. */
export function verifyManifest(root = process.cwd()): string[] {
    return verifyManifestReport(root).problems;
}

if (import.meta.main) {
    const [command, engineDir] = process.argv.slice(2);
    if (command === 'archives') {
        if (engineDir === undefined) {
            console.error('usage: bun tools/lib/manifest.ts archives <engine-dir>');
            process.exit(2);
        }
        let recorded = 0;
        try {
            const manifest = readManifest();
            recorded = Number(manifest.engine.archives.config !== null) + Number(manifest.engine.archives.interface !== null);
        } catch (err) {
            console.error(`STALE: manifest ${(err as Error).message}`);
            process.exit(1);
        }
        const problems = engineArchiveProblems(process.cwd(), engineDir);
        for (const problem of problems) console.error(`STALE: manifest ${problem}`);
        if (problems.length > 0) process.exit(1);
        if (recorded === 0) {
            console.log('manifest: no engine archive hash recorded yet — comparison skipped');
        } else {
            console.log(`ok: engine archives match the manifest (${recorded}/2 recorded)`);
        }
        process.exit(0);
    }
    if (command !== 'verify') {
        console.error('usage: bun tools/lib/manifest.ts verify | archives <engine-dir>');
        process.exit(2);
    }
    const report = verifyManifestReport();
    for (const line of report.skipped) console.log(line);
    for (const problem of report.problems) console.error(`STALE: manifest ${problem}`);
    if (report.problems.length > 0) process.exit(1);
    const manifest = readManifest();
    console.log(`ok: manifest matches ${manifest.artifacts.length} artifact(s) and ${Object.keys(manifest.generators).length} generator(s)`);
}
