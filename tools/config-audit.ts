// Why: an unknown config opcode desyncs every later entry, so decode every family under STRICT_CONFIG=1.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

process.env.STRICT_CONFIG = '1';
process.env.STRICT_PACKETS = '1';

const cacheIdx = process.argv.indexOf('--cache');
const configIdx = process.argv.indexOf('--config');
if (cacheIdx === -1 && configIdx === -1) {
    console.error('usage: bun tools/config-audit.ts --cache <data/pack/client-or-cache.json>');
    process.exit(2);
}

const cachePath = cacheIdx === -1 ? process.argv[configIdx + 1] : process.argv[cacheIdx + 1];
if (!cachePath) {
    console.error('usage: bun tools/config-audit.ts --cache <data/pack/client-or-cache.json>');
    process.exit(2);
}

type CacheBundle = { format?: number; archives?: Record<string, string> };

function loadBytes(name: string): Uint8Array {
    if (cachePath.endsWith('.json')) {
        const bundle = JSON.parse(readFileSync(cachePath, 'utf8')) as CacheBundle;
        const encoded = bundle.archives?.[name];
        if (typeof encoded !== 'string') {
            throw new Error(`cache bundle is missing archive ${name}`);
        }
        return new Uint8Array(Buffer.from(encoded, 'base64'));
    }
    const file = join(cachePath, name);
    if (!existsSync(file)) {
        throw new Error(`cache directory is missing ${name}`);
    }
    return new Uint8Array(readFileSync(file));
}

// STRICT_CONFIG is read at class definition; set the env above before these loads.
const { default: JagFile } = await import('../src/client/io/JagFile.js');
const { default: LocType } = await import('../src/client/config/LocType.js');
const { default: NpcType } = await import('../src/client/config/NpcType.js');
const { default: ObjType } = await import('../src/client/config/ObjType.js');
const { default: SeqType } = await import('../src/client/config/SeqType.js');
const { default: SpotType } = await import('../src/client/config/SpotType.js');
const { default: VarpType } = await import('../src/client/config/VarpType.js');
const { default: VarBitType } = await import('../src/client/config/VarBitType.js');
const { default: IdkType } = await import('../src/client/config/IdkType.js');
const { default: FloType } = await import('../src/client/config/FloType.js');
const { default: IfType } = await import('../src/client/config/IfType.js');
const { default: PixFont } = await import('../src/client/graphics/PixFont.js');

const config = new JagFile(loadBytes('config'));
const interfaces = new JagFile(loadBytes('interface'));
const media = new JagFile(loadBytes('media'));

function tryLoadBytes(name: string): Uint8Array | null {
    try {
        return loadBytes(name);
    } catch {
        return null;
    }
}

const titleBytes = tryLoadBytes('title');
let fonts: InstanceType<typeof PixFont>[] = [];
if (titleBytes) {
    const title = new JagFile(titleBytes);
    fonts = [PixFont.depack(title, 'p11_full', false), PixFont.depack(title, 'p12_full', false), PixFont.depack(title, 'b12_full', false), PixFont.depack(title, 'q8_full', true)];
}

SeqType.init(config);
LocType.init(config);
FloType.init(config);
ObjType.init(config, true);
NpcType.init(config);
IdkType.init(config);
SpotType.init(config);
VarpType.init(config);
VarBitType.init(config);
IfType.init(interfaces, media, fonts);

let failures = 0;

function visit(name: string, count: number, get: (id: number) => unknown): void {
    for (let id = 0; id < count; id++) {
        try {
            get(id);
        } catch (err) {
            console.error(`${name} ${id}: ${(err as Error).message}`);
            failures++;
        }
    }
}

visit('loc', LocType.numDefinitions, id => LocType.list(id));
visit('npc', NpcType.numDefinitions, id => NpcType.list(id));
visit('obj', ObjType.numDefinitions, id => ObjType.list(id));

let named = 0;
let modeled = 0;
let shaped = 0;
let active = 0;
let width = 0;
let length = 0;
let blockwalk = 0;
let blockrange = 0;
let ops = 0;
let multilocs = 0;
for (let id = 0; id < LocType.numDefinitions; id++) {
    let loc;
    try {
        loc = LocType.list(id);
    } catch {
        continue;
    }
    if (loc.name !== null) named++;
    if (loc.model) modeled++;
    if (loc.shape) shaped++;
    if (loc.active) active++;
    if (loc.width !== 1) width++;
    if (loc.length !== 1) length++;
    if (loc.blockwalk) blockwalk++;
    if (loc.blockrange) blockrange++;
    if (loc.op) ops++;
    if (loc.multiloc.length > 0) multilocs++;
}

const ifPopulated = IfType.list.filter(com => com != null).length;

console.log(`loc: ${LocType.numDefinitions} decoded (named=${named} modeled=${modeled} shaped=${shaped} active=${active} width=${width} length=${length} blockwalk=${blockwalk} blockrange=${blockrange} ops=${ops} multilocs=${multilocs})`);
console.log(`npc: ${NpcType.numDefinitions} decoded`);
console.log(`obj: ${ObjType.numDefinitions} decoded`);
console.log(`seq: ${SeqType.numDefinitions} decoded eagerly in init`);
console.log(`spot: ${SpotType.numDefinitions} decoded eagerly in init`);
console.log(`varbit: ${VarBitType.numDefinitions} decoded eagerly in init`);
console.log(`varp: ${VarpType.numDefinitions} decoded eagerly in init`);
console.log(`idk: ${IdkType.numDefinitions} decoded eagerly in init`);
console.log(`flo: ${FloType.numDefinitions} decoded eagerly in init`);
console.log(`if: ${IfType.list.length} slots, ${ifPopulated} populated`);
console.log(failures === 0 ? 'CONFIG AUDIT CLEAN' : `CONFIG AUDIT FAILED: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
