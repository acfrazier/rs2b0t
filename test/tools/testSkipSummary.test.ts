import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { generateSkipSummary } from '../../tools/lib/test-skip-summary.js';

const root = mkdtempSync(join(tmpdir(), 'test-skip-summary-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function source(path: string, lines: string[]): void {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, `${lines.join('\n')}\n`);
}

describe('generateSkipSummary', () => {
    test('lists every skipped testcase with an explicit reason or its source gate', () => {
        source('test/gated/routes.test.ts', [
            "import { describe, test } from 'bun:test';",
            "describe.skipIf(!existsSync('out/collision.lcnav.gz'))('routes', () => {",
            "    test('walks the route', () => {});",
            '});'
        ]);
        source('test/gated/config.test.ts', [
            "import { describe, test } from 'bun:test';",
            "describe.skipIf(skipUnless('engine'))('config audit', () => {",
            "    test('matches the configured engine', () => {});",
            '});',
            "describe.skipIf(skipUnless('content'))('content audit', () => {",
            "    test('matches the available content', () => {});",
            '});'
        ]);

        const junit = `<?xml version="1.0"?>
<testsuites name="bun test" skipped="3">
  <testsuite name="routes" file="test/gated/routes.test.ts" line="2" tests="1" skipped="1">
    <testcase name="walks the route" file="test/gated/routes.test.ts" line="3"><skipped /></testcase>
  </testsuite>
  <testsuite name="config audit" file="test/gated/config.test.ts" line="2" tests="1" skipped="1">
    <testcase name="matches the configured engine" file="test/gated/config.test.ts" line="3"><skipped /></testcase>
  </testsuite>
  <testsuite name="content audit" file="test/gated/config.test.ts" line="5" tests="1" skipped="1">
    <testcase name="matches the available content" file="test/gated/config.test.ts" line="6"><skipped /></testcase>
  </testsuite>
</testsuites>`;
        const log = [
            'SKIP: test/gated/config.test.ts: ENGINE_DIR absent or on another revision (ENGINE_DIR is unset)',
            'SKIP: test/gated/config.test.ts: CONTENT_DIR absent (CONTENT_DIR is unset)'
        ].join('\n');
        const summary = generateSkipSummary(junit, log, root);

        expect(summary).toContain('## Skipped tests (3)');
        expect(summary).toContain('test/gated/routes.test.ts:3 — walks the route — source gate at test/gated/routes.test.ts:2');
        expect(summary).toContain("!existsSync('out/collision.lcnav.gz')");
        expect(summary.split('\n').find(line => line.includes('matches the configured engine'))).toContain('ENGINE_DIR absent or on another revision');
        expect(summary.split('\n').find(line => line.includes('matches the configured engine'))).not.toContain('CONTENT_DIR absent');
        expect(summary.split('\n').find(line => line.includes('matches the available content'))).toContain('CONTENT_DIR absent');

    });

    test('reports when the JUnit report has no skipped tests', () => {
        expect(generateSkipSummary('<testsuites></testsuites>', '', root)).toBe('## Skipped tests\n\nNone reported by the JUnit report.');
    });
    test('fails closed when the JUnit skipped count exceeds its testcase details', () => {
        expect(() => generateSkipSummary('<testsuites skipped="1"></testsuites>', '', root)).toThrow('JUnit reports 1 skipped tests');
    });

});
