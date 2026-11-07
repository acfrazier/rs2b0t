/** The 377 staging tree must be inert before the cutover: this asserts the three exclusions, and two committed fixtures make every real `bun test`, `tsc --noEmit` and `eslint .` exercise them.
 *  Why: a staged edition whose imports resolve only after the cutover, or a staged test that would run against the 289 modules, must never turn a preparation slice red.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

import { readManifest } from '../../tools/lib/manifest.js';

const FIXTURE_TEST = 'data/377/test/x.test.ts';
const FIXTURE_SRC = 'data/377/src/x.ts';

const CUTOVER = readManifest().cutover;

describe('data/377/ is configured inert', () => {
    test('bun test discovers only test/', () => {
        const bunfig = readFileSync('bunfig.toml', 'utf8');
        expect(bunfig).toMatch(/^root = "test"$/m);
        expect(bunfig).toMatch(/^preload = \["\.\/test\/setup-dom\.ts", "\.\/test\/setup-env-guard\.ts", "\.\/test\/setup-static-guard\.ts"\]$/m);
    });

    test('tsc excludes data/377', () => {
        const tsconfig = JSON.parse(readFileSync('tsconfig.json', 'utf8')) as { exclude: string[] };
        expect(tsconfig.exclude).toContain('data/377');
    });

    test('eslint ignores data/377/', () => {
        const eslint = readFileSync('eslint.config.ts', 'utf8');
        const ignores = /globalIgnores\(\[([\s\S]*?)\]\)/.exec(eslint)?.[1] ?? '';
        expect(ignores).toContain("'data/377/'");
    });
});

describe.skipIf(CUTOVER)('before the cutover', () => {
    test('the throwing staged test and the unresolvable staged import are in place', () => {
        expect(existsSync(FIXTURE_TEST)).toBe(true);
        expect(existsSync(FIXTURE_SRC)).toBe(true);

        // The staged test must still be able to fail, or its absence from the run proves nothing.
        const expected = /expect\((.+)\)\.toBe\((.+)\);/.exec(readFileSync(FIXTURE_TEST, 'utf8'));
        expect(expected).not.toBeNull();
        expect(expected![1]).not.toBe(expected![2]);

        expect(readFileSync(FIXTURE_SRC, 'utf8')).toContain("from './no-such-module.js'");
        expect(existsSync('data/377/src/no-such-module.ts')).toBe(false);
    });

    test('data/377 exists', () => {
        expect(existsSync('data/377')).toBe(true);
    });
});

describe.skipIf(!CUTOVER)('after the cutover', () => {
    test('data/377 is gone', () => {
        expect(existsSync('data/377')).toBe(false);
    });
});
