import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run, settle } from '../../e2e/lib/runChild.js';
import { driftVerdict } from '../../tools/lib/e2e-report.js';

// Plan pitfall 10: a non-zero exit or a missing clean marker fails the gate.
const dir = mkdtempSync(join(tmpdir(), 'runchild-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function child(script: string): string[] {
    return ['bun', '-e', script];
}

describe('run (the e2e runner child executor)', () => {
    test('a clean marker with exit 7 fails: the exit status is not overridden by the verdict', async () => {
        const r = await run('exit7', child("console.log('ok: partial'); process.exit(7)"), join(dir, 'a.log'), 30_000, driftVerdict);
        expect(r.status).toBe('fail');
    });

    test('a clean marker with exit 0 passes', async () => {
        const r = await run('clean', child("console.log('ok: matches')"), join(dir, 'b.log'), 30_000, driftVerdict);
        expect(r.status).toBe('pass');
    });

    test('exit 0 without a clean marker fails the drift verdict', async () => {
        const r = await run('silent', child("console.log('nothing to see')"), join(dir, 'c.log'), 30_000, driftVerdict);
        expect(r.status).toBe('fail');
    });

    test('a STALE line fails even at exit 0', async () => {
        const r = await run('stale', child("console.log('ok: one\\nSTALE: two does not match')"), join(dir, 'd.log'), 30_000, driftVerdict);
        expect(r.status).toBe('fail');
    });

    test('a gate without a verdict follows its exit code', async () => {
        expect((await run('z', child('process.exit(0)'), join(dir, 'e.log'), 30_000)).status).toBe('pass');
        expect((await run('nz', child('process.exit(3)'), join(dir, 'f.log'), 30_000)).status).toBe('fail');
    });
});

describe('settle', () => {
    test('timeout outranks everything, a non-zero exit outranks the verdict', () => {
        expect(settle(true, 0, 'ok: x', driftVerdict)).toBe('timeout');
        expect(settle(false, 7, 'ok: x', driftVerdict)).toBe('fail');
        expect(settle(false, 0, 'ok: x', driftVerdict)).toBe('pass');
    });
});
