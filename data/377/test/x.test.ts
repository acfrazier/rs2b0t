// Fixture for test/repo/stagingInert.test.ts, not a real test: if the discovery exclusions ever
// regress, this file runs and fails the suite instead of passing silently.
import { expect, test } from 'bun:test';

test('data/377 must never be discovered by bun test', () => {
    expect('the staging tree is inert').toBe('a discovered test file');
});
