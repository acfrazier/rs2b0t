import { test } from 'bun:test';

/**
 * Why: a test whose scenario the 377 data does not contain, or that pins a 289 content program the plan leaves unqualified on 377 until a named later slice, is skipped by name and reason, never edited to a 377 expectation (pitfall 12); the SKIP line reaches the hosted summary and RS2B0T-377-SCI-1107/skips.md lists each reason.
 * Returns `test.skip`, so a caller keeps its test body and can still use `.each`.
 */
export function skip377(file: string, reason: string): typeof test.skip {
    console.log(`SKIP: ${file}: ${reason}`);
    return test.skip;
}
