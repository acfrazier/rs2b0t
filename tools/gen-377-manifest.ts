/** Update `data/manifest.json` for staged 377 data builds: engine and content provenance, toolchain,
 *  generator script hashes, and artifact hashes.
 *  Why: the manifest is the only record tying an artifact to its generator, engine and content
 *  commit (pitfall 10/11); `tools/lib/manifest.ts verify` enforces it everywhere.
 *
 *  Merge semantics: scalar fields and the listed rows are replaced; artifact rows this run does
 *  not name (another slice's) are preserved untouched. Staged `out` rows use their final `out/`
 *  path and a `stagedPath` source under `data/377/`. Artifacts are sorted by path.
 *
 *  Usage:
 *    bun tools/gen-377-manifest.ts --revision 377 \
 *      --engine-dir <dir> --engine-commit <sha40> --content-commit <sha40> \
 *      --node <version> --bun <version> \
 *      [--generator <repo path>]… [--artifact <repo path>=<kind>[:<qualification>]]… \
 *      [--out-dir <dir>] [--seed-manifest <previous generated manifest>]
 *
 *  A staged artifact is named by its `data/377/<repo path>` source; an `out` artifact there is
 *  recorded at its post-cutover `out/` path. `--seed-manifest` supplies the previous generated
 *  manifest only when the current file cannot be parsed (for merge-conflict regeneration).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
    ARTIFACT_KINDS,
    QUALIFICATIONS,
    parseManifest,
    readManifest,
    sha256File,
    STAGING_ROOT,
    writeManifest,
    type ArtifactKind,
    type Manifest,
    type ManifestArtifact,
    type Qualification
} from './lib/manifest.js';

interface Args {
    revision: number;
    engineDir: string | null;
    engineCommit: string | null;
    contentCommit: string | null;
    node: string | null;
    bun: string | null;
    generators: string[];
    artifacts: { path: string; kind: ArtifactKind; qualification: Qualification }[];
    outDir: string;
    seedManifest: string | null;
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    const args: Args = {
        revision: 0,
        engineDir: null,
        engineCommit: null,
        contentCommit: null,
        node: null,
        bun: null,
        generators: [],
        artifacts: [],
        outDir: 'out',
        seedManifest: null
    };
    const need = (i: number, flag: string): string => {
        const value = argv[i];
        if (value === undefined || value.startsWith('--')) {
            console.error(`${flag} requires a value`);
            process.exit(2);
        }
        return value;
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        switch (flag) {
            case '--revision':
                args.revision = Number(need(++i, flag));
                break;
            case '--engine-dir':
                args.engineDir = need(++i, flag);
                break;
            case '--engine-commit':
                args.engineCommit = need(++i, flag);
                break;
            case '--content-commit':
                args.contentCommit = need(++i, flag);
                break;
            case '--node':
                args.node = need(++i, flag);
                break;
            case '--bun':
                args.bun = need(++i, flag);
                break;
            case '--generator':
                args.generators.push(need(++i, flag));
                break;
            case '--artifact': {
                const spec = need(++i, flag);
                const eq = spec.indexOf('=');
                if (eq === -1) {
                    console.error(`--artifact expects <repo path>=<kind>[:<qualification>], got '${spec}'`);
                    process.exit(2);
                }
                const path = spec.slice(0, eq);
                const [kind, qualification = 'pending'] = spec.slice(eq + 1).split(':');
                if (!ARTIFACT_KINDS.includes(kind as ArtifactKind)) {
                    console.error(`--artifact ${path}: unknown kind '${kind}'`);
                    process.exit(2);
                }
                if (!QUALIFICATIONS.includes(qualification as Qualification)) {
                    console.error(`--artifact ${path}: unknown qualification '${qualification}'`);
                    process.exit(2);
                }
                args.artifacts.push({ path, kind: kind as ArtifactKind, qualification: qualification as Qualification });
                break;
            }
            case '--out-dir':
                args.outDir = need(++i, flag);
                break;
            case '--seed-manifest':
                args.seedManifest = need(++i, flag);
                break;
            default:
                console.error(`unknown arg: ${flag}`);
                process.exit(2);
        }
    }
    if (!Number.isInteger(args.revision) || args.revision <= 0) {
        console.error('--revision must be a positive integer');
        process.exit(2);
    }
    return args;
}

/** Hash one artifact source and record it under its final repo-relative path. */
function artifactRow(spec: { path: string; kind: ArtifactKind; qualification: Qualification }, sourceRoot: string): ManifestArtifact {
    const abs = join(sourceRoot, spec.path);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
        throw new Error(`artifact source missing: ${spec.path} (under ${sourceRoot})`);
    }
    const stagedOut = spec.kind === 'out' && spec.path.startsWith(`${STAGING_ROOT}/out/`);
    const path = stagedOut ? relative(STAGING_ROOT, spec.path).split('\\').join('/') : spec.path;
    return {
        path,
        sha256: sha256File(abs),
        kind: spec.kind,
        qualification: spec.qualification,
        ...(stagedOut ? { stagedPath: spec.path } : {})
    };
}

function main(): void {
    const args = parseArgs();
    let manifest: Manifest;
    try {
        manifest = readManifest();
    } catch {
        if (args.seedManifest !== null) {
            manifest = parseManifest(JSON.parse(readFileSync(args.seedManifest, 'utf8')));
        } else {
            manifest = {
                schemaVersion: 1,
                revision: args.revision,
                cutover: false,
                engine: { commit: null, archives: { config: null, interface: null } },
                content: { commit: null },
                toolchain: { node: null, bun: null },
                generators: {},
                artifacts: []
            };
        }
    }

    manifest.revision = args.revision;
    if (args.engineCommit !== null) manifest.engine.commit = args.engineCommit;
    if (args.contentCommit !== null) manifest.content.commit = args.contentCommit;
    if (args.engineDir !== null) {
        for (const name of ['config', 'interface'] as const) {
            const abs = join(args.engineDir, 'data', 'pack', 'client', name);
            if (!existsSync(abs)) {
                throw new Error(`engine archive missing: ${join(args.engineDir, 'data/pack/client', name)}`);
            }
            manifest.engine.archives[name] = sha256File(abs);
        }
    }
    if (args.node !== null) manifest.toolchain.node = args.node;
    if (args.bun !== null) manifest.toolchain.bun = args.bun;

    for (const generator of args.generators) {
        const abs = join(process.cwd(), generator);
        if (!existsSync(abs)) {
            throw new Error(`generator script missing: ${generator}`);
        }
        manifest.generators[generator] = sha256File(abs);
    }
    manifest.generators = Object.fromEntries(Object.entries(manifest.generators).sort(([a], [b]) => a.localeCompare(b)));

    // Why: a byte-identity run hashes its basemap from a scratch directory while the row keeps
    // the repo's untracked path, so the manifest stays comparable between runs.
    const outRows = readdirSync(args.outDir)
        .filter(f => f.startsWith('worldmap-') && statSync(join(args.outDir, f)).isFile())
        .map(f => ({ path: `out/${f}`, sha256: sha256File(join(args.outDir, f)), kind: 'out' as const, qualification: 'pending' as const }));

    // Rows named this run are replaced; rows for other slices' artifacts survive. This tool owns
    // every `out/worldmap-*` row, so one whose file this bake did not produce is stale.
    const fresh = args.artifacts.map(spec => artifactRow(spec, process.cwd()));
    const named = new Set([...fresh.map(a => a.path), ...outRows.map(a => a.path)]);
    const kept = manifest.artifacts.filter(a => !named.has(a.path) && !a.path.startsWith('out/worldmap-'));
    manifest.artifacts = [...kept, ...fresh, ...outRows].sort((a, b) => a.path.localeCompare(b.path));

    writeManifest(process.cwd(), manifest);
    console.log(`manifest: revision ${manifest.revision}, ${manifest.artifacts.length} artifact(s), ${Object.keys(manifest.generators).length} generator(s)`);
}

main();
