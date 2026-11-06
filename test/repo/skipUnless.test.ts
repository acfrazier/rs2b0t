/** Section 3's five input-keyed skip groups: the CI summary and `driftVerdict` are only as good as
 *  the lines this helper prints, so the vocabulary and the verdict are pinned here.
 */
import { describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { driftVerdict, parseSkips, skippedLocalGroups } from '../../tools/lib/e2e-report.js';
import { missingInput, resetSkipInputs, skipUnless } from '../lib/skipUnless.js';

/** Run `fn` with console.log captured, so a deliberate skip does not pollute the CI skip summary. */
function quietly(fn: () => boolean): { value: boolean; lines: string[] } {
    const spy = spyOn(console, 'log').mockImplementation(() => undefined);
    try {
        const value = fn();
        return { value, lines: spy.mock.calls.map(call => String(call[0])) };
    } finally {
        spy.mockRestore();
    }
}

describe('skip reasons parse back to their group', () => {
    const line = (reason: string): string => `SKIP: test/io/protDrift.test.ts: ${reason} (detail)`;

    test('every group round-trips through parseSkips', () => {
        const engine = parseSkips(
            'SKIP: test/io/protDrift.test.ts: ENGINE_DIR absent or on another revision (engine is revision 377, the committed client is 289)'
        );
        expect(engine).toHaveLength(1);
        expect(engine[0]?.file).toBe('test/io/protDrift.test.ts');
        expect(engine[0]?.input).toBe('engine');

        const content = parseSkips(line('CONTENT_DIR absent'));
        expect(content[0]?.input).toBe('content');
        const bundle = parseSkips(line('RS2B0T_CACHE_BUNDLE absent'));
        expect(bundle[0]?.input).toBe('cache-bundle');
        const pack = parseSkips(line('out/collision.lcnav.gz absent'));
        expect(pack[0]?.input).toBe('collision-pack');
        const prod = parseSkips(line('PROD_RSAE/PROD_RSAN absent'));
        expect(prod[0]?.input).toBe('prod-rsa');
    });

    test('an unrelated SKIP line has no group', () => {
        expect(parseSkips('SKIP: test/x.test.ts: the clock is not mocked')[0]?.input).toBeNull();
    });
});

describe('driftVerdict reads the skip list', () => {
    test('a clean marker with no skips passes', () => {
        expect(driftVerdict('ok: src/bot/data/shopdb.ts matches the content pack')).toBe('pass');
        expect(driftVerdict('src/bot/data/dropdb.ts is up to date')).toBe('pass');
    });

    test('STALE and a missing marker fail', () => {
        expect(driftVerdict('STALE: x does not match the content pack')).toBe('fail');
        expect(driftVerdict('nothing to report')).toBe('fail');
    });

    test('a skipped local input fails even next to a clean marker', () => {
        const text = 'ok: src/bot/data/shopdb.ts matches the content pack\nSKIP: test/data/shop.test.ts: CONTENT_DIR absent (CONTENT_DIR is unset)';
        expect(skippedLocalGroups(text)).toEqual(['content']);
        expect(driftVerdict(text)).toBe('fail');
    });

    test('groups 1-4 all fail; group 5 does not, and allowSkips is explicit', () => {
        for (const reason of ['ENGINE_DIR absent or on another revision', 'CONTENT_DIR absent', 'RS2B0T_CACHE_BUNDLE absent', 'out/collision.lcnav.gz absent']) {
            expect(driftVerdict(`ok: x\nSKIP: test/x.test.ts: ${reason} (detail)`)).toBe('fail');
        }
        expect(driftVerdict('ok: x\nSKIP: test/x.test.ts: PROD_RSAE/PROD_RSAN absent (detail)')).toBe('pass');
        expect(driftVerdict('ok: x\nSKIP: test/x.test.ts: CONTENT_DIR absent (detail)', { allowSkips: ['content'] })).toBe('pass');
    });
});

describe('skipUnless detects the local inputs', () => {
    test('CONTENT_DIR with a scripts/ directory is present', () => {
        const dir = mkdtempSync(join(tmpdir(), 'skip-content-'));
        try {
            mkdirSync(join(dir, 'scripts'));
            process.env.CONTENT_DIR = dir;
            resetSkipInputs();
            expect(missingInput('content')).toBeNull();
            expect(quietly(() => skipUnless('content'))).toEqual({ value: false, lines: [] });
        } finally {
            delete process.env.CONTENT_DIR;
            resetSkipInputs();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('an unset CONTENT_DIR skips with the reason the parser knows', () => {
        delete process.env.CONTENT_DIR;
        resetSkipInputs();
        expect(missingInput('content')).toBe('CONTENT_DIR is unset');
        const run = quietly(() => skipUnless('content'));
        expect(run.value).toBe(true);
        expect(run.lines).toHaveLength(1);
        expect(run.lines[0]).toMatch(/^SKIP: test\/repo\/skipUnless\.test\.ts: CONTENT_DIR absent \(CONTENT_DIR is unset\)$/);
        // One line per file and reason, however many call sites ask.
        expect(quietly(() => skipUnless('content')).lines).toEqual([]);
        resetSkipInputs();
    });

    test('an engine on another revision skips', () => {
        const dir = mkdtempSync(join(tmpdir(), 'skip-engine-'));
        try {
            mkdirSync(join(dir, 'src/util'), { recursive: true });
            // A revision the committed 289 client is not on.
            writeFileSync(join(dir, 'src/util/WorldConfig.ts'), 'revision: 377\n');
            process.env.ENGINE_DIR = dir;
            resetSkipInputs();
            const why = missingInput('engine');
            expect(why).toContain('engine is revision 377');
            const run = quietly(() => skipUnless('engine'));
            expect(run.value).toBe(true);
            expect(run.lines[0]).toContain('SKIP: test/repo/skipUnless.test.ts: ENGINE_DIR absent or on another revision');
        } finally {
            delete process.env.ENGINE_DIR;
            resetSkipInputs();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
