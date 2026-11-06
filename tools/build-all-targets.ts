/** Why: pitfall 7. `bundleDefines` used to skip when no bundle existed, so a `process.env` leak and a `prod`-only compile break were invisible; this builds both bundlers, every entry, both targets with one identity and both strict flags on.
 *  Usage: bun tools/build-all-targets.ts [--dummy-rsa] [--plan] (without a prod key, `--dummy-rsa` bakes a fixed test pair that pack and deploy refuse).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { buildIdentityLabel, resolveBuildIdentity } from './lib/buildIdentity.js';
import type { BuildIdentity } from './lib/buildIdentity.js';

const args = process.argv.slice(2);
const dummyRsa = args.includes('--dummy-rsa');
const plan = args.includes('--plan');
const unknown = args.filter(arg => arg !== '--dummy-rsa' && arg !== '--plan');
if (unknown.length > 0) {
    console.error(`unknown argument(s): ${unknown.join(', ')}\nusage: bun tools/build-all-targets.ts [--dummy-rsa] [--plan]`);
    process.exit(2);
}

const TARGETS = ['local', 'prod'] as const;

/** Every file the two bundlers write; the defines test requires the ones this build records. */
const OUTPUTS = [
    'out/client.js',
    'out/client.js.map',
    'out/mapview.js',
    'out/mapview.js.map',
    'out/ondemandworker.js',
    'out/ondemandworker.js.map',
    'out/botclient.js',
    'out/botclient.js.map',
    'out/multibox.js',
    'out/multibox.js.map',
    'out/navworker.js',
    'out/navworker.js.map',
    'out/tinymidipcm.wasm',
    'out/target.json',
    'out/version.json'
];

interface BuildRecord {
    schemaVersion: 1;
    targets: string[];
    dummyRsa: boolean;
    strict: { packets: string; config: string };
    identity: BuildIdentity;
    outputs: string[];
}

const prodKey = (process.env.PROD_RSAN ?? '').trim() !== '';
if (prodKey && dummyRsa) {
    console.error('--dummy-rsa refuses to run while PROD_RSAN is set: the artifact must not be a dummy build.');
    process.exit(1);
}
if (!prodKey && !dummyRsa) {
    console.error('TARGET=prod needs PROD_RSAE and PROD_RSAN (the game server\'s public pair), or --dummy-rsa for a compile check.');
    process.exit(1);
}

const identity = resolveBuildIdentity();
const record: BuildRecord = {
    schemaVersion: 1,
    targets: [...TARGETS],
    dummyRsa,
    strict: { packets: '1', config: '1' },
    identity,
    outputs: OUTPUTS
};

if (plan) {
    console.log(`build:all-targets plan (${buildIdentityLabel(identity)})`);
    for (const target of TARGETS) {
        const rsa = target === 'prod' ? (dummyRsa ? 'dummy' : 'PROD_RSAE/PROD_RSAN') : 'LOCAL_RSAE/LOCAL_RSAN or defaults';
        console.log(`  ${target}: bundle.ts (client, mapview, ondemandworker) + bot.bundle.ts (botclient, multibox, ondemandworker, navworker), rsa=${rsa}`);
    }
    console.log(`  outputs: ${OUTPUTS.length}`);
    process.exit(0);
}

const childEnv = (target: string): Record<string, string | undefined> => ({
    ...process.env,
    TARGET: target,
    RS2B0T_TARGET: target,
    // Why: one identity for every artifact of this build, including the client bundle.
    RS2B0T_GIT_COMMIT: identity.commit,
    RS2B0T_GIT_DIRTY: identity.dirty ? '1' : '0',
    RS2B0T_BUILD_TIME: identity.builtAt,
    // Pitfall 3: the shipped bundles must be strict, not the empty default, and every output goes
    // to out/ so the recorded paths and the defines test agree.
    STRICT_PACKETS: '1',
    STRICT_CONFIG: '1',
    B0T_OUT_DIR: 'out'
});

function run(label: string, argv: string[], target: string): void {
    const started = Date.now();
    const proc = Bun.spawnSync(argv, { env: childEnv(target), stdout: 'pipe', stderr: 'pipe' });
    const stdout = proc.stdout.toString().trim();
    const stderr = proc.stderr.toString().trim();
    if ((proc.exitCode ?? 1) !== 0) {
        console.error(`${label} failed (${argv.join(' ')}):\n${stderr || stdout}`);
        process.exit(1);
    }
    const last = stdout.split('\n').filter(Boolean).pop() ?? '';
    console.log(`  ok ${label} (${Date.now() - started}ms)${last ? ` — ${last}` : ''}`);
}

for (const target of TARGETS) {
    console.log(`build:all-targets: ${target}`);
    run(`${target} client`, ['bun', 'run', 'bundle.ts'], target);
    const botArgs = ['bun', 'run', 'bot.bundle.ts'];
    if (target === 'prod' && dummyRsa) botArgs.push('--dummy-rsa');
    run(`${target} bot`, botArgs, target);
}

const missing = OUTPUTS.filter(path => !existsSync(path));
if (missing.length > 0) {
    console.error(`build:all-targets: missing output(s):\n  ${missing.join('\n  ')}`);
    process.exit(1);
}

const recordPath = 'out/build-targets.json';
writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);

const version: unknown = JSON.parse(readFileSync('out/version.json', 'utf8'));
const writtenRsa = typeof version === 'object' && version !== null && 'rsa' in version ? version.rsa : undefined;
if ((writtenRsa === 'dummy') !== dummyRsa) {
    console.error(`build:all-targets: out/version.json says rsa=${String(writtenRsa)} but the build ${dummyRsa ? 'is' : 'is not'} dummy`);
    process.exit(1);
}

console.log(`build:all-targets: ${OUTPUTS.length} output(s), ${recordPath}, git=${buildIdentityLabel(identity)}${dummyRsa ? ' (rsa: dummy)' : ''}`);
