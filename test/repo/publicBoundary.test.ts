/** Pitfall 20: reads the Git index and fails on `/Users/`/`/Volumes/` paths, key material, `password=`, or a tracked `.pem`/`.rs2`/`.loc`/`.npc`/`.obj`/`.inv`/`.pack` file.
 *  Why an allowlist: upstream `main` already carries 14 such matches, frozen by path, rule, exact text and reason; an unmatched or duplicate entry fails, and only an upstream merge grows the list.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { readManifest } from '../../tools/lib/manifest.js';

const ALLOWLIST = 'test/repo/publicBoundary.allow.json';

/** The two files this guard owns: the allowlist must quote matched text, and this test must build
 *  fabricated violations, so both would otherwise match their own rules. Nothing else is exempt. */
const SELF_OWNED = new Set([ALLOWLIST, 'test/repo/publicBoundary.test.ts']);

const LITERALS = ['/Users/', '/Volumes/', '-----BEGIN', 'password='];
const EXTENSIONS = ['.pem', '.rs2', '.loc', '.npc', '.obj', '.inv', '.pack'];
const REASONS = ['upstream-home-path', 'synthetic-credential-fixture', 'upstream-289-fixture'];

interface Finding {
    path: string;
    /** The rule that fired: one of LITERALS for a line match, one of EXTENSIONS for a file kind. */
    needle: string;
    /** The exact matched text: the whole source line, or the file extension. */
    match: string;
}

interface AllowEntry extends Finding {
    reason: string;
}

interface GitResult {
    code: number;
    out: string;
    err: string;
}

function git(root: string, args: string[]): GitResult {
    const run = Bun.spawnSync(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'pipe' });
    return { code: run.exitCode ?? 1, out: run.stdout.toString(), err: run.stderr.toString() };
}

/** Every literal and extension finding in `root`'s index, minus the guard's own files. */
function indexFindings(root: string): Finding[] {
    const grepArgs = ['grep', '--cached', '-n', '-F'];
    for (const needle of LITERALS) grepArgs.push('-e', needle);
    grepArgs.push('--', '.');
    const grep = git(root, grepArgs);
    // git grep exits 1 when nothing matched; anything above that is a real failure.
    if (grep.code > 1) throw new Error(`git grep failed in ${root}: ${grep.err.trim()}`);

    const findings: Finding[] = [];
    for (const line of grep.out.split('\n')) {
        if (line === '') continue;
        const first = line.indexOf(':');
        const second = line.indexOf(':', first + 1);
        const path = line.slice(0, first);
        const match = line.slice(second + 1);
        const needle = LITERALS.find(n => match.includes(n));
        if (needle === undefined) continue;
        findings.push({ path, needle, match });
    }

    const files = git(root, ['ls-files']);
    if (files.code !== 0) throw new Error(`git ls-files failed in ${root}: ${files.err.trim()}`);
    for (const path of files.out.split('\n')) {
        if (path === '') continue;
        const lower = path.toLowerCase();
        const needle = EXTENSIONS.find(ext => lower.endsWith(ext));
        if (needle !== undefined) findings.push({ path, needle, match: needle });
    }

    return findings.filter(f => !SELF_OWNED.has(f.path));
}

const findingKey = (finding: Finding): string => `${finding.path}\u0000${finding.needle}\u0000${finding.match}`;

/** Every reason the findings and the allowlist disagree; empty means the index is clean. */
function violations(findings: Finding[], allow: AllowEntry[]): string[] {
    const problems: string[] = [];
    const unmatched = new Map<string, AllowEntry>();
    for (const entry of allow) {
        const key = findingKey(entry);
        if (unmatched.has(key)) problems.push(`duplicate allowlist entry: ${entry.path} [${entry.needle}]`);
        unmatched.set(key, entry);
    }

    for (const finding of findings) {
        const key = findingKey(finding);
        if (unmatched.delete(key)) continue;
        const shown = finding.match.trim().slice(0, 100);
        problems.push(`unallowlisted ${finding.path}: ${finding.needle} in "${shown}"`);
    }

    for (const entry of unmatched.values()) problems.push(`dead allowlist entry: ${entry.path} [${entry.needle}]`);
    return problems;
}

/** The allowlist is a committed file, so its shape is checked once here rather than assumed. */
function readAllowlist(path: string): AllowEntry[] {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof raw !== 'object' || raw === null || !('entries' in raw)) throw new Error(`${path}: expected {"entries": [...]}`);
    const entries = raw.entries;
    if (!Array.isArray(entries)) throw new Error(`${path}: entries must be an array`);

    return entries.map((entry: unknown, i: number): AllowEntry => {
        if (typeof entry !== 'object' || entry === null) throw new Error(`${path}: entries[${i}] must be an object`);
        const entryPath = 'path' in entry ? entry.path : undefined;
        const needle = 'needle' in entry ? entry.needle : undefined;
        const match = 'match' in entry ? entry.match : undefined;
        const reason = 'reason' in entry ? entry.reason : undefined;
        for (const [key, value] of [['path', entryPath], ['needle', needle], ['match', match], ['reason', reason]] as const) {
            if (typeof value !== 'string' || value === '') throw new Error(`${path}: entries[${i}].${key} must be a non-empty string`);
        }
        return { path: entryPath as string, needle: needle as string, match: match as string, reason: reason as string };
    });
}

function headerHasPath(value: unknown): boolean {
    if (typeof value === 'string') return /[\\/:~]/.test(value);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) => /(?:path|directory|dir)$/i.test(key) || headerHasPath(child));
}

/** Publication checks are independent of the cache bundle and inspect staged bytes, not working-tree replacements. */
function recordingViolations(root: string): string[] {
    const files = git(root, ['ls-files', '-z', '--', 'test/io/recordings']);
    if (files.code !== 0) throw new Error('could not enumerate indexed recordings');
    const problems: string[] = [];
    for (const path of files.out.split('\0').filter(path => path.endsWith('.jsonl'))) {
        const blob = git(root, ['show', `:${path}`]);
        if (blob.code !== 0) throw new Error('could not read an indexed recording');
        let records: unknown[];
        try { records = blob.out.trimEnd().split('\n').map(line => JSON.parse(line)); }
        catch { problems.push(`${path}: invalid recording JSON`); continue; }
        const header = records[0];
        if (!header || typeof header !== 'object' || !('type' in header) || header.type !== 'header') {
            problems.push(`${path}: recording must begin with a header`);
            continue;
        }
        if (headerHasPath(header)) problems.push(`${path}: recording header contains a path`);
        let acceptedSegment: unknown = undefined;
        for (const [offset, record] of records.slice(1).entries()) {
            if (!record || typeof record !== 'object' || !('type' in record)) {
                problems.push(`${path}: invalid record at line ${offset + 2}`);
                continue;
            }
            if (record.type === 'login') {
                acceptedSegment = undefined;
                const replies = 'replies' in record ? record.replies : undefined;
                const segment = 'segment' in record ? record.segment : undefined;
                if (typeof segment === 'number' && Array.isArray(replies) && replies[0] === 0 && [2, 15].includes(replies.at(-1))) acceptedSegment = segment;
            } else if (record.type === 'end') acceptedSegment = undefined;
            else if (record.type === 'frame' && (!('segment' in record) || acceptedSegment === undefined || record.segment !== acceptedSegment)) {
                problems.push(`${path}: game frame precedes an accepted login reply at line ${offset + 2}`);
            }
        }
    }
    return problems;
}

const TEMP_DIRS: string[] = [];

/** A throwaway git repository so the fabricated violations go through the real index scan. */
function tempRepo(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'public-boundary-'));
    TEMP_DIRS.push(dir);
    expect(git(dir, ['init', '-q']).code).toBe(0);
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), content);
    }
    expect(git(dir, ['add', '--', ...Object.keys(files)]).code).toBe(0);
    return dir;
}

afterAll(() => {
    for (const dir of TEMP_DIRS) rmSync(dir, { recursive: true, force: true });
});

describe('publicBoundary', () => {
    test('the index passes with exactly the 12 remaining frozen entries', () => {
        const findings = indexFindings(process.cwd());
        const allow = readAllowlist(ALLOWLIST);

        expect(findings).toHaveLength(12);
        expect(allow).toHaveLength(12);
        for (const entry of allow) expect(REASONS).toContain(entry.reason);
        expect(violations(findings, allow)).toEqual([]);
    });

    test('a tracked file containing a home path fails', () => {
        const dir = tempRepo({ 'src/leak.ts': 'export const engine = "/Users/x/code/engine";\n' });
        const findings = indexFindings(dir);
        expect(findings).toHaveLength(1);
        expect(violations(findings, [])).toEqual([expect.stringContaining('unallowlisted src/leak.ts: /Users/')]);
    });

    test('a tracked .pem fails', () => {
        const dir = tempRepo({ 'keys/private.pem': 'x\n' });
        const findings = indexFindings(dir);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.needle).toBe('.pem');
        expect(violations(findings, [])).toHaveLength(1);
    });

    test('a tracked .loc fails', () => {
        const dir = tempRepo({ 'content/locs.loc': 'x\n' });
        const findings = indexFindings(dir);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.needle).toBe('.loc');
        expect(violations(findings, [])).toHaveLength(1);
    });

    test('an allowlist entry with no match fails', () => {
        const findings = indexFindings(process.cwd());
        const allow = readAllowlist(ALLOWLIST);
        const dead: AllowEntry = {
            path: 'notes/gone.md',
            needle: '/Users/',
            match: '  ENGINE_DIR=/Users/x/code/engine',
            reason: 'upstream-home-path'
        };
        expect(violations(findings, [...allow, dead])).toEqual([expect.stringContaining('dead allowlist entry: notes/gone.md')]);
    });

    test('a duplicate allowlist entry fails', () => {
        const findings = indexFindings(process.cwd());
        const allow = readAllowlist(ALLOWLIST);
        const [first] = allow;
        expect(first).toBeDefined();
        expect(violations(findings, [...allow, first!])).toEqual([expect.stringContaining('duplicate allowlist entry')]);
    });
});

describe('publicBoundary recordings', () => {
    const file = 'test/io/recordings/377/example.jsonl';
    const header = { type: 'header', engineCommit: 'abcdef0123', accountPrefix: 'tap', archiveHashes: { config: '0123abcd' } };
    const login = { type: 'login', segment: 1, replies: [0, 2] };
    const frame = { type: 'frame', segment: 1, direction: 'in', bytes: '05' };
    const jsonl = (...records: unknown[]) => records.map(record => JSON.stringify(record)).join('\n') + '\n';

    test('every indexed recording has a path-free header and accepted login before game frames', () => {
        expect(recordingViolations(process.cwd())).toEqual([]);
    });
    test('a recording header path fails, including nested and non-home paths', () => {
        for (const source of ['/home/operator/engine', 'C:\\engine\\cache', '../cache']) {
            const dir = tempRepo({ [file]: jsonl({ ...header, provenance: { source } }, login, frame) });
            expect(recordingViolations(dir)).toEqual([expect.stringContaining('header contains a path')]);
        }
    });
    test('an inbound frame before any login reply fails', () => {
        const dir = tempRepo({ [file]: jsonl(header, frame, login) });
        expect(recordingViolations(dir)).toEqual([expect.stringContaining('precedes an accepted login reply')]);
    });
    test('failed login replies and a previous segment do not authorize frames', () => {
        for (const records of [
            [header, { ...login, replies: [0, 6] }, frame],
            [header, login, { ...frame, segment: 2 }],
            [header, login, { type: 'end', segment: 1 }, frame]
        ]) {
            const dir = tempRepo({ [file]: jsonl(...records) });
            expect(recordingViolations(dir)).toEqual([expect.stringContaining('precedes an accepted login reply')]);
        }
    });
    test('valid indexed bytes pass even if the working tree contains a different recording', () => {
        const dir = tempRepo({ [file]: jsonl(header, login, frame) });
        writeFileSync(join(dir, file), jsonl({ ...header, enginePath: '/home/operator/engine' }, frame));
        expect(recordingViolations(dir)).toEqual([]);
    });
});

describe('the manifest owns the staging lifecycle', () => {
    test.skipIf(!readManifest().cutover)('data/377 is absent once the cutover happened', () => {
        expect(existsSync('data/377')).toBe(false);
    });

    test.skipIf(readManifest().cutover)('data/377 is present before the cutover', () => {
        expect(existsSync('data/377')).toBe(true);
    });
});
