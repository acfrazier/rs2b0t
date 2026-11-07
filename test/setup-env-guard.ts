import { afterEach } from 'bun:test';

// Why: bun runs every test file in one process, and a test that deleted CONTENT_DIR made every later file skip its content and engine gates, so the full suite hid a failing clue audit behind green skips. A test may change these inputs only if it puts the caller's value back.
const GUARDED = ['CONTENT_DIR', 'ENGINE_DIR'] as const;
const callerEnv = new Map<string, string | undefined>(GUARDED.map(name => [name, process.env[name]]));

afterEach(() => {
    const changed = GUARDED.filter(name => process.env[name] !== callerEnv.get(name));
    if (changed.length === 0) {
        return;
    }
    // Restore first, so one bad test fails alone instead of silently skipping every later file.
    for (const name of changed) {
        const value = callerEnv.get(name);
        if (value === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = value;
        }
    }
    throw new Error(`this test left ${changed.join(' and ')} changed; restore the caller's value in a finally block`);
});
