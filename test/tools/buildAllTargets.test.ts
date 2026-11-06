/** `build:all-targets` decides the `prod` key mode before building; pitfall 8 wants the wrong choice loud, and `--plan` exercises that decision without a build. */
import { describe, expect, test } from 'bun:test';

function plan(env: Record<string, string | undefined>, args: string[] = []): { code: number | null; out: string; err: string } {
    const run = Bun.spawnSync(['bun', 'tools/build-all-targets.ts', '--plan', ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, PROD_RSAE: undefined, PROD_RSAN: undefined, ...env }
    });
    return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
}

describe('build:all-targets planning', () => {
    test('without a prod key and without --dummy-rsa it refuses to plan', () => {
        const run = plan({});
        expect(run.code).toBe(1);
        expect(run.err).toContain('PROD_RSAE and PROD_RSAN');
        expect(run.err).toContain('--dummy-rsa');
    });

    test('with --dummy-rsa it plans every entry for both targets', () => {
        const run = plan({}, ['--dummy-rsa']);
        expect(run.code).toBe(0);
        expect(run.out).toContain('local:');
        expect(run.out).toContain('prod:');
        expect(run.out).toContain('rsa=dummy');
        expect(run.out).toContain('bundle.ts (client, mapview, ondemandworker)');
        expect(run.out).toContain('bot.bundle.ts (botclient, multibox, ondemandworker, navworker)');
    });

    test('with the real pair it plans a keyed prod build', () => {
        const run = plan({ PROD_RSAE: '65537', PROD_RSAN: '9'.repeat(309) });
        expect(run.code).toBe(0);
        expect(run.out).toContain('rsa=PROD_RSAE/PROD_RSAN');
    });

    test('--dummy-rsa refuses to run while PROD_RSAN is set', () => {
        const run = plan({ PROD_RSAE: '65537', PROD_RSAN: '9'.repeat(309) }, ['--dummy-rsa']);
        expect(run.code).toBe(1);
        expect(run.err).toContain('must not be a dummy build');
    });

    test('an unknown argument is a usage error', () => {
        const run = plan({}, ['--nope']);
        expect(run.code).toBe(2);
        expect(run.err).toContain('unknown argument');
    });
});
