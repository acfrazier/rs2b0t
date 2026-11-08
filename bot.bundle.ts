import fs from 'fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { buildDefines, buildIdentityLabel, resolveBuildIdentity, writeVersionJson } from './tools/lib/buildIdentity.js';
import type { BuildIdentity, LoginKey } from './tools/lib/buildIdentity.js';

// Build src/bot/main.ts as botclient.js, keeping console output.
// Why: external scripts and self-tests use ABI property names, so skip terser; Bun only shortens locals.

const USAGE = 'usage: bun bot.bundle.ts [dev] [--dummy-rsa]';
const args = process.argv.slice(2);
const dev = args.includes('dev');
const dummyRsa = args.includes('--dummy-rsa');
const unknown = args.filter(arg => arg !== 'dev' && arg !== '--dummy-rsa');
if (unknown.length > 0) {
    console.error(`unknown argument(s): ${unknown.join(', ')}\n${USAGE}`);
    process.exit(2);
}
const prod = !dev;

const TARGET_NAME = process.env.TARGET ?? 'local';

// 1024-bit RSA keys, exponent 65537.
// Local matches the engine's private.pem; override with LOCAL_RSAE/LOCAL_RSAN. Live uses LIVE_RSAN.
// prod runs on the game server; PROD_RSAE/PROD_RSAN are that engine's public pair (section 6).
const TARGET_RSA: Record<string, LoginKey> = {
    local: {
        rsae: process.env.LOCAL_RSAE ?? '65537',
        rsan:
            process.env.LOCAL_RSAN ??
            '135523076496100112838368820296627333081299340012903560093710594598681655098748405760144616526347126272127045237860467661349157596468705435014708178676542187051745346055229544524388140867808854007219907874939518784380039390430841371837588073879981616508242779530473286487605800927487856120184640386127488369021'
    },
    proxy: { rsae: '65537', rsan: process.env.LIVE_RSAN ?? '' },
    live: {
        rsae: '65537',
        rsan: process.env.LIVE_RSAN ?? ''
    },
    prod: {
        rsae: process.env.PROD_RSAE ?? '',
        rsan: process.env.PROD_RSAN ?? ''
    }
};

if (!(TARGET_NAME in TARGET_RSA)) {
    console.error(`Unknown TARGET '${TARGET_NAME}'. Valid: ${Object.keys(TARGET_RSA).join(', ')}.`);
    process.exit(1);
}

/** A fixed public test pair for the CI `prod` compile. It matches no engine, so a login under it
 *  fails with reply 6; `version.json` marks the artifact `rsa: dummy`, and `tools/pack-rs2b0t.sh`
 *  and `deployIsolatedClient` refuse to deploy it. */
const DUMMY_RSA: LoginKey = { rsae: '65537', rsan: `1${'7'.repeat(308)}` };

let rsa = TARGET_RSA[TARGET_NAME]!;
let rsaMode: 'keyed' | 'dummy' = 'keyed';
if ((TARGET_NAME === 'live' || TARGET_NAME === 'proxy' || TARGET_NAME === 'prod') && (rsa.rsan === '' || rsa.rsae === '')) {
    if (TARGET_NAME === 'prod' && dummyRsa) {
        rsa = DUMMY_RSA;
        rsaMode = 'dummy';
    } else {
        const envVars = TARGET_NAME === 'prod' ? 'PROD_RSAE and PROD_RSAN' : 'LIVE_RSAN';
        console.error(`TARGET=${TARGET_NAME} requires ${envVars} (rs2b2t rotated modulus), or --dummy-rsa for a prod compile check. Aborting.`);
        process.exit(1);
    }
}
if (dummyRsa && rsaMode !== 'dummy') {
    console.error(`--dummy-rsa is a prod compile check only; TARGET=${TARGET_NAME} already has a key (or is local). Aborting.`);
    process.exit(1);
}

const identity: BuildIdentity = rsaMode === 'dummy' ? { ...resolveBuildIdentity(), rsa: 'dummy' } : resolveBuildIdentity();
const define = buildDefines(identity, TARGET_NAME, rsa);

const out = process.env.B0T_OUT_DIR ?? 'out';
fs.mkdirSync(out, { recursive: true });

const SPESSA_PROCESSOR = 'node_modules/spessasynth_lib/dist/spessasynth_processor.min.js';
if (!fs.existsSync(SPESSA_PROCESSOR)) {
    console.error(`missing ${SPESSA_PROCESSOR} — bun install spessasynth_lib@4.3.13`);
    process.exit(1);
}
fs.copyFileSync(SPESSA_PROCESSOR, join(out, 'spessasynth_processor.min.js'));

const entrypoints: [entry: string, output: string][] = [
    ['src/bot/main.ts', 'botclient.js'],
    ['src/bot/multibox/main.ts', 'multibox.js'],
    ['src/client/io/OnDemandWorker.ts', 'ondemandworker.js'],
    ['src/bot/event/webwalk/NavWorker.ts', 'navworker.js']
];

for (const [entry, output] of entrypoints) {
    const build = await Bun.build({
        entrypoints: [entry],
        sourcemap: 'external',
        define,
        minify: prod
    });

    if (!build.success) {
        build.logs.forEach((x: unknown) => console.log(x));
        process.exit(1);
    }

    let source = await build.outputs[0].text();
    const sourcemap = build.outputs[0].sourcemap ? await build.outputs[0].sourcemap.text() : '';

    // the bundle is renamed on disk; keep the sourcemap pointer in sync
    const generatedName = build.outputs[0].path.split('/').pop()!;
    source = source.replace(`sourceMappingURL=${generatedName}.map`, `sourceMappingURL=${output}.map`);

    fs.writeFileSync(join(out, output), source);
    fs.writeFileSync(join(out, `${output}.map`), sourcemap);
}

writeVersionJson(join(out, 'version.json'), identity);
fs.writeFileSync(
    join(out, 'target.json'),
    JSON.stringify({
        target: TARGET_NAME,
        worldRouting: 1,
        botclientSha256: createHash('sha256')
            .update(fs.readFileSync(join(out, 'botclient.js')))
            .digest('hex')
    }) + '\n'
);
console.log(`bot bundle built (${prod ? 'prod' : 'dev'}): ${join(out, 'botclient.js')}  git=${buildIdentityLabel(identity)}`);
if (rsaMode === 'dummy') {
    console.log('rsa: dummy — a compile check only; tools/pack-rs2b0t.sh and deployIsolatedClient refuse this artifact');
}
