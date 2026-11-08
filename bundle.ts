import fs from 'fs';
import path from 'path';

import { minify } from 'terser';

import { nth_identifier } from './identifier.js';
import { buildDefines, resolveBuildIdentity } from './tools/lib/buildIdentity.js';

// Why: config/target.ts reads this unconditionally; leaving it undefined puts a ReferenceError in the browser bundle.
const TARGET_NAME = process.env.RS2B0T_TARGET ?? 'local';

// The original key, used 2003-2010. Only the login block of this client uses it; the bot build bakes
// the target engine's pair, and build:all-targets builds both with one identity.
const CLIENT_RSA = {
    rsae: process.env.LOGIN_RSAE ?? '58778699976184461502525193738213253649000149147835990136706041084440742975821',
    rsan: process.env.LOGIN_RSAN ?? '7162900525229798032761816791230527296329313291232324290237849263501208207972894053929065636522363163621000728841182238772712427862772219676577293600221789'
};

const define = buildDefines(resolveBuildIdentity(), TARGET_NAME, CLIENT_RSA);

type BunOutput = {
    source: string;
    sourcemap: string;
};

async function bunBuild(entry: string, external: string[] = [], minify = true, drop: string[] = []): Promise<BunOutput> {
    const build = await Bun.build({
        entrypoints: [entry],
        sourcemap: 'external',
        define,
        external,
        minify,
        drop
    });

    if (!build.success) {
        build.logs.forEach(x => console.log(x));
        process.exit(1);
    }

    return {
        source: await build.outputs[0].text(),
        sourcemap: build.outputs[0].sourcemap ? await build.outputs[0].sourcemap.text() : ''
    };
}

async function applyTerser(script: BunOutput): Promise<void> {
    const mini = await minify(script.source, {
        sourceMap: {
            content: script.sourcemap
        },
        toplevel: true,
        compress: {
            ecma: 2020
        },
        mangle: {
            nth_identifier: nth_identifier,
            // Why: Spessa main-thread ↔ AudioWorklet talks in property names; mangling them mutes MIDI (pitfall 28).
            properties: false
        }
    });

    script.source = mini.code ?? '';
    script.sourcemap = mini.map?.toString() ?? '';
}

if (!fs.existsSync('out')) {
    fs.mkdirSync('out');
}

const SPESSA_PROCESSOR = 'node_modules/spessasynth_lib/dist/spessasynth_processor.min.js';
if (!fs.existsSync(SPESSA_PROCESSOR)) {
    console.error(`missing ${SPESSA_PROCESSOR} — bun install spessasynth_lib@4.3.13`);
    process.exit(1);
}
fs.copyFileSync(SPESSA_PROCESSOR, 'out/spessasynth_processor.min.js');

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== 'dev');
if (unknown.length > 0) {
    console.error(`unknown argument(s): ${unknown.join(', ')}`);
    process.exit(2);
}
const prod = !args.includes('dev');

const entrypoints = ['src/client/shell/Client.ts', 'src/client/mapview/MapView.ts', 'src/client/io/OnDemandWorker.ts'];

for (const file of entrypoints) {
    const output = path.basename(file).replace('.ts', '.js').toLowerCase();

    const script = await bunBuild(file, [], prod, prod ? ['console'] : []);
    if (prod) {
        await applyTerser(script);
    }

    fs.writeFileSync(`out/${output}`, script.source);
    fs.writeFileSync(`out/${output}.map`, script.sourcemap);
}
