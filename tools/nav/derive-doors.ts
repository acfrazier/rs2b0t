import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

import { CLIENT_VERSION } from '#/client/io/ClientProt.js';
import { LocLayer, LocShape, locShapeLayer } from '#/bot/event/webwalk/rsmod/flags.js';

import { Reader, bridgedLevel, forEachLoc, loadLocTypes, loadMapsquares, parseLands } from './lib.js';

interface DoorEdge {
    x: number;
    z: number;
    level: number;
    locId: number;
    locName: string;
    dir: 'N' | 'E' | 'S' | 'W';
}

const ANGLE_DIR: ('W' | 'N' | 'E' | 'S')[] = ['W', 'N', 'E', 'S'];
interface DoorCategoryRule {
    decision: 'admit' | 'refuse';
    source: string;
}

interface DoorCategoryTable {
    schemaVersion: 1;
    categories: Record<string, DoorCategoryRule>;
    uncategorized: DoorCategoryRule;
    locOverrides: Record<string, DoorCategoryRule>;
}

function loadDoorCategoryTable(): DoorCategoryTable {
    const rulesPath = path.join(process.env.NAV_DATA_ROOT ?? '.', 'tools/nav/door-categories.json');
    const table = JSON.parse(fs.readFileSync(rulesPath, 'utf8')) as DoorCategoryTable;
    if (table.schemaVersion !== 1 || !table.categories || !table.uncategorized || !table.locOverrides) {
        throw new Error('Invalid tools/nav/door-categories.json schema');
    }
    if (!['admit', 'refuse'].includes(table.uncategorized.decision) || !table.uncategorized.source) {
        throw new Error('Invalid door rule for uncategorized locs');
    }
    for (const [category, rule] of Object.entries(table.categories)) {
        if (!category || !rule || !['admit', 'refuse'].includes(rule.decision) || !rule.source) {
            throw new Error(`Invalid door category rule '${category}'`);
        }
    }
    for (const [locId, rule] of Object.entries(table.locOverrides)) {
        if (!/^\d+$/.test(locId) || !rule || !['admit', 'refuse'].includes(rule.decision) || !rule.source) {
            throw new Error(`Invalid door loc override '${locId}'`);
        }
    }
    return table;
}

function loadCategoryNames(content: string): Map<number, string> {
    const categoryPath = path.join(content, 'pack', 'category.pack');
    const categoryNames = new Map<number, string>();
    for (const [index, raw] of fs.readFileSync(categoryPath, 'utf8').split(/\r?\n/).entries()) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        const match = /^(\d+)=(.+)$/.exec(line);
        if (!match) {
            throw new Error(`${categoryPath}:${index + 1}: invalid category declaration`);
        }
        const id = Number(match[1]);
        const name = match[2].trim();
        if (categoryNames.has(id) || !name) {
            throw new Error(`${categoryPath}:${index + 1}: duplicate or empty category`);
        }
        categoryNames.set(id, name);
    }
    return categoryNames;
}

function validateCategoryNames(table: DoorCategoryTable, categoryNames: Map<number, string>): void {
    const names = new Set(categoryNames.values());
    for (const category of Object.keys(table.categories)) {
        if (!names.has(category)) {
            throw new Error(`tools/nav/door-categories.json names unknown category '${category}'`);
        }
    }
}

function parseArgs(): { engine: string; content: string; out: string; revision: number } {
    const args = process.argv.slice(2);
    let engine = process.env.ENGINE_DIR ?? path.join(homedir(), 'code', 'rs2b2t-engine');
    let content = process.env.CONTENT_DIR ?? path.join(homedir(), 'code', 'rs2b2t-content');
    let out = 'src/bot/event/webwalk/data/doors.json';
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--engine') {
            engine = args[++i];
        } else if (args[i] === '--content') {
            content = args[++i];
        } else if (args[i] === '--out') {
            out = args[++i];
        } else {
            console.error(`unknown argument: ${args[i]}`);
            process.exit(2);
        }
    }
    const revision = process.env.REVISION === undefined ? CLIENT_VERSION : Number(process.env.REVISION);
    return { engine, content, out, revision };
}

function main(): void {
    const opts = parseArgs();
    const { configs } = loadLocTypes(opts.engine, opts.revision);

    const categoryPolicy = opts.revision === 377 ? loadDoorCategoryTable() : null;
    const categoryNames = opts.revision === 377 ? loadCategoryNames(opts.content) : null;
    if (categoryPolicy && categoryNames) {
        validateCategoryNames(categoryPolicy, categoryNames);
    }

    // Why: only a placed wall-layer loc can produce a door edge; Open props outside that scope need no door policy.
    const mapsquareData = loadMapsquares(opts.engine);
    const wallLocIds = new Set<number>();
    for (const { loc } of mapsquareData) {
        forEachLoc(new Reader(loc), instance => {
            if (locShapeLayer(instance.shape) === LocLayer.WALL) {
                wallLocIds.add(instance.locId);
            }
        });
    }
    const openable = new Set<number>();
    const unclassified = new Map<string, Set<number>>();
    let refusedTypes = 0;
    for (const id of [...wallLocIds].sort((a, b) => a - b)) {
        const type = configs[id];
        if (!type.op || !type.op.some(op => op?.toLowerCase() === 'open')) {
            continue;
        }
        if (opts.revision === 289) {
            // Doors that advertise Open but require quest-specific handling.
            // Why: routing through these doors makes the walker repeatedly retry a refused interaction.
            const SCRIPT_REFUSED = new Set([
                'closet_door', '1to2', '2to3', '4to5', '5to6', '8to9', '2to5', '3to6', '4to7', '5to8',
                // Rashiliyia's skeletal doors open only to the 3 bones.
                'thzq_tombrooml1', 'thzq_tombrooml2', 'thzq_tombrooml3', 'thzq_tombroomr1', 'thzq_tombroomr2',
                // The outer tomb gate needs the Beads of the Dead.
                'zombiequeengateclosedl', 'zombiequeengateclosedr',
                // McGrubor's Wood stays locked; use the Loose Railing edge in transports.json.
                'mcgruborgatel', 'mcgruborgater',
                // Melzar's Maze keys teleport through their matching doors; funexit is a one-way exit.
                'melzardoor', 'reddoor', 'orangedoor', 'yellowdoor', 'bluedoor', 'magentadoor', 'greendoor', 'funexit',
                // The Oracle's door: silk, an unfired bowl, a lobster pot and a mind bomb, and only after she's been asked about the map.
                'dragon_slayer_magic_door',
                // Elvarg's lair, locked until the ship has sailed, and Crandor's secret door, which only opens from the island side.
                'elvarg_gate_right', 'elvarg_gate_left', 'dragonsecretdoor',
                // Family Crest doors require different combinations of the three levers.
                // Why: opening one door can close another; defs/familycrest/mine.ts handles the sequence.
                'famcrest_doorh2', 'famcrest_doorh2i2', 'famcrest_doorg2h1',
                'famcrest_doori2h1', 'famcrest_doorh2g1',
                // Fight Arena cells don't open; door1 teleports into the arena at stages 9-11.
                // Why: ordinary routing could strand the bot in a cell or send it into a boss fight.
                'arena_prisondoor', 'arena_jeremydoor', 'fightarena_door1',
                // Clock Tower's cage gate opens from inside; use ctlevera to enter.
                // Why: only the cage at 2595,9657 is map-placed; Fight Arena copies are added at runtime.
                'ctratgatea',
                // The plague house needs a warrant and mourner dialogue; loc_2534 never opens.
                'loc_2534', 'loc_2535',
                // Why: mourner HQ requires poisoned stew, a doctor's gown and dialogue; enter through the fence at 2541,3331.
                'mournerstewdoor',
                // Why: the Phoenix weapon store needs a key use-on; the other hideouts require membership and teleport through the door.
                'phoenixdoor', 'phoenixdoor2', 'blackarmdoor',
                // Why: the Legends outer gate needs Search with a lockpick; the inner gate needs a strength prompt the walker can't answer.
                'lglockpickgatebottoml', 'lglockpickgatebottomr', 'lgstrengthtrialgatel', 'lgstrengthtrialgater',
                // Why: the Khazard door only opens from the north; defs/treegnome enters through the crumbled wall.
                'khazard_stronghold_door',
                // Peer's door1 needs the combination and an empty inventory; door2 needs the key used from inside.
                // Why: ordinary routing can strand the bot inside the puzzle house.
                'viking_seers_door1', 'viking_seers_door2',
                // Why: keep the longhall backstage door; the bouncer blocks entry but the bard still needs the exit.
                // Rellekka's north fence: "Only Fremenniks may pass this gate." until the trials are over.
                'viking_fencegate_l', 'viking_fencegate_r',
                // Why: Brimhaven doors check quest stage and gang before teleporting through; defs/heroquest/doors.ts handles them.
                'grubordoor', 'garvdoor', 'herokitchendoor', 'pete_sidedoor', 'pete_treasuredoor',
                // Why: Taverley doors need the jail or dusty key used on them; defs/heroquest/eel.ts handles both.
                'dungeonjail', 'deepdungeondoor'
            ]);
            const label = `${type.name ?? ''} ${type.debugname ?? ''}`.toLowerCase();
            if (label.includes('locked') || (type.debugname ?? '').startsWith('macro_') || SCRIPT_REFUSED.has(type.debugname ?? '')) {
                refusedTypes++;
                continue;
            }
            openable.add(id);
            continue;
        }

        const categoryId = type.category;
        const category = categoryId === null ? undefined : categoryNames?.get(categoryId);
        const rule = categoryPolicy?.locOverrides[String(id)] ?? (
            categoryId === null ? categoryPolicy?.uncategorized : category ? categoryPolicy?.categories[category] : undefined
        );
        if (!rule) {
            const label = category ? `${category} (${categoryId})` : `unknown category id ${categoryId ?? 'none'}`;
            const ids = unclassified.get(label) ?? new Set<number>();
            ids.add(id);
            unclassified.set(label, ids);
        } else if (rule.decision === 'admit') {
            openable.add(id);
        } else {
            refusedTypes++;
        }
    }
    if (unclassified.size > 0) {
        console.error('unclassified Open loc categories:');
        for (const [category, ids] of [...unclassified.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            console.error(`  ${category}:`);
            for (const id of [...ids].sort((a, b) => a - b)) {
                const name = configs[id]?.name;
                console.error(`    ${id}${name ? ` (${name})` : ''}`);
            }
        }
        process.exit(1);
    }

    const ONE_WAY_EXCLUDED = opts.revision === 289 ? new Set([
        '3108,3353,0', '3109,3353,0',
        // Handelmort's inner door only opens from the north; Cromperty's teleport reaches the interior.
        // Why: a two-way edge creates an unusable shortcut; travelCatalog.ts provides the exit edge.
        '2635,3321,0',
        // Gu'Tanoth's east gate demands a gold bar or teleports the player away.
        // Why: keep the north-west gate; it becomes a normal door after showing the relic and is needed to reach the west.
        '2549,3028,0', '2550,3028,0'
    ]) : new Set<string>();
    // Why: gates.rs2 leaves Gate#3198 closed after loc_add(type=-1); use Gate#3197 one tile north.
    const BROKEN_ENGINE_EXCLUDED = opts.revision === 289 ? new Set(['3198@3312,3235,0']) : new Set<string>();
    // Why: 2-tile doors sit on an unwalkable loc tile, so WALL_STRAIGHT derivation never emits them.
    const CURATED_EXTRA: DoorEdge[] = opts.revision === 289 ? [
        { x: 3107, z: 3162, level: 0, locId: 1536, locName: 'Door', dir: 'E' }
    ] : [];

    const edges: DoorEdge[] = [];
    const skippedShapes = new Map<string, number>();
    const nameCounts = new Map<string, number>();
    let mapsquares = 0;
    let oneWaySkipped = 0;
    let brokenEngineSkipped = 0;

    for (const { mx, mz, land, loc } of mapsquareData) {
        mapsquares++;
        const baseX = mx << 6;
        const baseZ = mz << 6;
        const lands = parseLands(new Reader(land));

        forEachLoc(new Reader(loc), instance => {
            if (!openable.has(instance.locId) || locShapeLayer(instance.shape) !== LocLayer.WALL) {
                return;
            }

            const type = configs[instance.locId];
            const level = bridgedLevel(lands, instance.coord, instance.x, instance.z, instance.level);
            if (level < 0) {
                return;
            }

            if (instance.shape !== LocShape.WALL_STRAIGHT) {
                const shapeName = Object.entries(LocShape).find(([, value]) => value === instance.shape)?.[0] ?? `${instance.shape}`;
                skippedShapes.set(shapeName, (skippedShapes.get(shapeName) ?? 0) + 1);
                return;
            }

            if (ONE_WAY_EXCLUDED.has(`${baseX + instance.x},${baseZ + instance.z},${level}`)) {
                oneWaySkipped++;
                return;
            }
            if (BROKEN_ENGINE_EXCLUDED.has(`${instance.locId}@${baseX + instance.x},${baseZ + instance.z},${level}`)) {
                brokenEngineSkipped++;
                return;
            }
            const locName = type.name ?? type.debugname ?? `loc_${instance.locId}`;
            edges.push({
                x: baseX + instance.x,
                z: baseZ + instance.z,
                level,
                locId: instance.locId,
                locName,
                dir: ANGLE_DIR[instance.angle]
            });
            nameCounts.set(locName, (nameCounts.get(locName) ?? 0) + 1);
        });
    }

    for (const extra of CURATED_EXTRA) {
        edges.push(extra);
        nameCounts.set(extra.locName, (nameCounts.get(extra.locName) ?? 0) + 1);
    }

    edges.sort((a, b) => a.level - b.level || a.x - b.x || a.z - b.z || a.locId - b.locId);

    const json = '[\n' + edges.map(edge => '    ' + JSON.stringify(edge)).join(',\n') + '\n]\n';
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, json);

    console.log(`openable wall loc types: ${openable.size} (skipped ${refusedTypes} policy-refused types, ${oneWaySkipped} one-way instances -> curated transports, ${brokenEngineSkipped} broken Engine instances)`);
    console.log(`mapsquares scanned: ${mapsquares}`);
    console.log(`door edges derived: ${edges.length} -> ${opts.out}`);
    console.log('by name:');
    for (const [name, count] of [...nameCounts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${count}\t${name}`);
    }
    if (skippedShapes.size > 0) {
        console.log('skipped non-straight wall shapes with Open op:');
        for (const [shape, count] of skippedShapes) {
            console.log(`  ${count}\t${shape}`);
        }
    }

    if (opts.revision === 289) {
        const expect: [number, number, string][] = [
            [3236, 3296, 'E'],
            [3236, 3295, 'E'],
            [3208, 3211, 'N']
        ];
        for (const [x, z, dir] of expect) {
            const hit = edges.find(edge => edge.x === x && edge.z === z && edge.level === 0);
            const ok = hit && hit.dir === dir;
            console.log(`${ok ? 'PASS' : 'FAIL'}  expected ${dir}-edge at (${x},${z},0): ${hit ? `${hit.locName} dir=${hit.dir}` : 'missing'}`);
            if (!ok) {
                process.exitCode = 1;
            }
        }
    }
}

main();
