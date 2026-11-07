/** Why: `--stage <dir>` lets preparation slices land green on the 289 branch while producing 377 artifacts, and `REVISION` selects what the generators decode; see docs/how-to/build-and-data.md. */
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** The `--stage <dir>` argument, or null when the generator writes at its repo path. */
export function stageArg(): string | null {
    const argv = process.argv;
    const i = argv.indexOf('--stage');
    if (i === -1) {
        return null;
    }
    const dir = argv[i + 1];
    if (dir === undefined || dir.startsWith('--')) {
        throw new Error('--stage requires a directory argument');
    }
    return dir;
}

/** Where a generated module goes: `<stage>/<repo path>` when staging, else the repo path itself. */
export function resolveOut(repoPath: string): string {
    const stage = stageArg();
    if (stage === null) {
        return repoPath;
    }
    if (isAbsolute(repoPath)) {
        throw new Error(`repo path must be relative: ${repoPath}`);
    }
    return join(stage, repoPath);
}

/** The committed client revision, read without importing the generated table. */
export function committedRevision(): number {
    const source = readFileSync(join(process.cwd(), 'src/client/io/ClientProt.ts'), 'utf8');
    const m = /export const CLIENT_VERSION = (\d+);/.exec(source);
    if (!m) {
        throw new Error('src/client/io/ClientProt.ts has no CLIENT_VERSION literal');
    }
    return Number(m[1]);
}

/** The revision the generator decodes for: `REVISION` env, else the committed `CLIENT_VERSION`. */
export function resolveRevision(): number {
    const env = process.env.REVISION;
    if (env !== undefined && env !== '') {
        const revision = Number(env);
        if (!Number.isInteger(revision) || revision <= 0) {
            throw new Error(`REVISION must be a positive integer, got '${env}'`);
        }
        return revision;
    }
    return committedRevision();
}
