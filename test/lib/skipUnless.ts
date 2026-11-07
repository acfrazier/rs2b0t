/** Why: a skipped drift check and a passing one used to print the same green line, so a hosted run with no engine, content or collision pack looked like a full pass; every skip prints one `SKIP: <file>: <reason>` line here and `driftVerdict` refuses a local gate that skipped groups 1-4.
 *  The vocabulary and parser live in `tools/lib/e2e-report.ts`; this module owns detection and printing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { LOCAL_GATE_GROUPS, SKIP_GROUPS, SKIP_REASON, parseSkips } from '../../tools/lib/e2e-report.js';
import type { InputKey, SkipLine } from '../../tools/lib/e2e-report.js';

export { LOCAL_GATE_GROUPS, SKIP_GROUPS, SKIP_REASON, parseSkips };
export type { InputKey, SkipLine };

const REPO_ROOT = process.cwd();

/** Read the committed client revision without importing the generated table. */
function committedRevision(): number | null {
    try {
        const source = readFileSync(join(REPO_ROOT, 'src/client/io/ClientProt.ts'), 'utf8');
        const m = /export const CLIENT_VERSION = (\d+);/.exec(source);
        return m ? Number(m[1]) : null;
    } catch {
        return null;
    }
}

/** The engine's revision from either shape: 377's Environment.ts or the 289 WorldConfig.ts. */
function engineRevision(engineDir: string): number | null {
    try {
        const environment = readFileSync(join(engineDir, 'src/util/Environment.ts'), 'utf8');
        const m = /ENGINE_REVISION[^\n]*,\s*(\d+)\s*\)/.exec(environment);
        if (m) return Number(m[1]);
    } catch {
        // 289 engines have no Environment.ts ENGINE_REVISION; fall through to WorldConfig.
    }
    try {
        const worldConfig = readFileSync(join(engineDir, 'src/util/WorldConfig.ts'), 'utf8');
        const m = /revision:\s*(\d+)/.exec(worldConfig);
        return m ? Number(m[1]) : null;
    } catch {
        return null;
    }
}

function engineWhy(): string | null {
    const dir = (process.env.ENGINE_DIR ?? '').trim();
    if (!dir) return 'ENGINE_DIR is unset';
    if (!existsSync(dir)) return 'ENGINE_DIR does not exist';
    const engine = engineRevision(dir);
    const committed = committedRevision();
    if (engine === null) return 'ENGINE_DIR has no readable engine revision';
    if (committed === null) return 'src/client/io/ClientProt.ts has no CLIENT_VERSION';
    if (engine !== committed) return `engine is revision ${engine}, the committed client is ${committed}`;
    return null;
}

function contentWhy(): string | null {
    const dir = (process.env.CONTENT_DIR ?? '').trim();
    if (!dir) return 'CONTENT_DIR is unset';
    if (!existsSync(join(dir, 'scripts'))) return `${dir}/scripts does not exist`;
    return null;
}

function cacheBundleWhy(): string | null {
    const dir = (process.env.RS2B0T_CACHE_BUNDLE ?? '').trim();
    if (!dir) return 'RS2B0T_CACHE_BUNDLE is unset';
    if (!existsSync(dir)) return 'RS2B0T_CACHE_BUNDLE does not exist';
    return null;
}

function collisionPackWhy(): string | null {
    return existsSync(join(REPO_ROOT, 'out/collision.lcnav.gz')) ? null : 'out/collision.lcnav.gz has not been baked';
}

function prodRsaWhy(): string | null {
    if (!(process.env.PROD_RSAE ?? '').trim()) return 'PROD_RSAE is unset';
    if (!(process.env.PROD_RSAN ?? '').trim()) return 'PROD_RSAN is unset';
    return null;
}

const WHY: Record<InputKey, () => string | null> = {
    engine: engineWhy,
    content: contentWhy,
    'cache-bundle': cacheBundleWhy,
    'collision-pack': collisionPackWhy,
    'prod-rsa': prodRsaWhy
};

const missing = new Map<InputKey, string | null>();
const printed = new Set<string>();

/** Forget the memoized checks; a test that changes an input between cases calls this. */
export function resetSkipInputs(): void {
    missing.clear();
}

/** Why `key` is unavailable, with the observed detail, or null when it is present. */
export function missingInput(key: InputKey): string | null {
    if (!missing.has(key)) {
        missing.set(key, WHY[key]());
    }
    return missing.get(key) ?? null;
}

/** The test file calling `skipUnless`, repo-relative; the stack is the only thing that knows it. */
function callerFile(): string {
    const frames = (new Error().stack ?? '').split('\n').slice(1);
    for (const frame of frames) {
        const m = /(?:^\s*at\s+|\()([^()\s]+):\d+:\d+\)?\s*$/.exec(frame);
        const path = m?.[1]?.replace(/^file:\/\//, '');
        if (!path || !path.startsWith('/') || path.endsWith('/test/lib/skipUnless.ts')) continue;
        const rel = relative(REPO_ROOT, path);
        return (rel.startsWith('..') ? path : rel).split('\\').join('/');
    }
    return 'unknown test file';
}

/**
 * Print one `SKIP: <file>: <reason>` line and return true when the test must skip.
 * Call at module top level: `describe.skipIf(skipUnless('engine'))('…', () => …)`.
 */
export function skipUnless(key: InputKey): boolean {
    const why = missingInput(key);
    if (why === null) return false;

    const file = callerFile();
    const reason = `${SKIP_REASON[key]} (${why})`;
    const id = `${file}\u0000${reason}`;
    if (!printed.has(id)) {
        printed.add(id);
        console.log(`SKIP: ${file}: ${reason}`);
    }
    return true;
}
