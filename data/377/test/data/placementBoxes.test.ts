import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { COW_LOCATIONS, isCowFieldLootTile } from '#/bot/data/cowKillerLocations.js';
import { FISHING_LOCATIONS } from '#/bot/data/fishingLocations.js';
import { MINING_LOCATIONS } from '#/bot/data/miningLocations.js';
import { WOODCUTTING_LOCATIONS } from '#/bot/data/woodcuttingLocations.js';
import { ROCK_TYPES, resolveRockIds } from '#/bot/data/miningRocks.js';
import { DEFAULT_CAMP_RADIUS } from '#/bot/data/gatheringLocations.js';

/**
 * The 377 placement-derived camp boxes (pitfall 18).
 *
 * Why: a camp box is the area the script hunts/gathers inside, so it must still cover what the 377 content
 * places. The P9 lesson (`IMPDORIC-377-1106`): undersized boxes turn a spawn/teleport outside the
 * box into a `NoTarget` that looks like a capability bug. This derives each box's required coverage from the
 * 377 sources at run time instead of restating tiles:
 * - loc resources (rocks, trees): every placement of a declared resource type near the camp lies inside the
 *   camp box, and every declared resource has at least one placement inside it;
 * - npc resources (fishing spots): the spots are the direct targets and do not wander (`wanderrange=0` in
 *   `scripts/_unpack/377/all.npc`), so every spot placement near the camp lies inside the camp box;
 * - cow fields: the leash is a loot leash, not a spawn fence (a southern Lumbridge cow may die outside it by
 *   design), so the field must keep a farmed herd (at least three Cow-named spawns inside the leash), and
 *   the per-field enumerations stay pinned in CowKillerLocations.test.ts;
 * - named script teleports: the desert-rescue teleport landings (`quests/quest_desertrescue/configs/
 *   desertrescue.constant:45-46`) must land inside their camp boxes, the one 377 script teleport into a camp.
 *
 * Inputs: ENGINE_DIR must be the 377 engine (its pack supplies the loc defs and the packed map squares),
 * CONTENT_DIR the 377 content (npc.pack ids and the all.npc wander fields). Both absent in hosted runs.
 */
import { Reader, forEachLoc, loadLocTypes, loadMapsquares } from '../../tools/nav/lib.js';

const ENGINE = (process.env.ENGINE_DIR ?? '').trim();
const CONTENT = (process.env.CONTENT_DIR ?? '').trim();

function engineRevision(dir: string): number | null {
    try {
        const environment = readFileSync(join(dir, 'src/util/Environment.ts'), 'utf8');
        const m = /ENGINE_REVISION[^\n]*,\s*(\d+)\s*\)/.exec(environment);
        if (m) return Number(m[1]);
    } catch {
        // fall through to the 289-style WorldConfig
    }
    try {
        const worldConfig = readFileSync(join(dir, 'src/util/WorldConfig.ts'), 'utf8');
        const m = /revision:\s*(\d+)/.exec(worldConfig);
        return m ? Number(m[1]) : null;
    } catch {
        return null;
    }
}

const engine377 = ENGINE.length > 0 && existsSync(ENGINE) && engineRevision(ENGINE) === 377;
const content377 = CONTENT.length > 0
    && existsSync(join(CONTENT, 'pack', 'npc.pack'))
    && existsSync(join(CONTENT, 'scripts', '_unpack', '377'));

if (!engine377 || !content377) {
    const why = !engine377
        ? `ENGINE_DIR absent or on another revision (needs the 377 engine, got ${ENGINE || 'unset'})`
        : 'CONTENT_DIR absent (needs the 377 content: pack/npc.pack and scripts/_unpack/377)';
    console.log(`SKIP: test/data/placementBoxes.test.ts: ${why}`);
}

const cheb = (ax: number, az: number, bx: number, bz: number): number => Math.max(Math.abs(ax - bx), Math.abs(az - bz));

/** One 377 loc placement. */
interface LocAt { id: number; x: number; z: number; level: number }

/** One 377 npc placement with its wander fields. */
interface NpcAt { id: number; x: number; z: number; level: number; maxrange: number; wanderrange: number; display: string }

let cache: { locs: LocAt[]; locNamesById: Map<number, string>; npcs: NpcAt[]; displayById: Map<number, string> } | null = null;

function load377World(): { locs: LocAt[]; locNamesById: Map<number, string>; npcs: NpcAt[]; displayById: Map<number, string> } {
    if (cache) return cache;
    // Loc defs and display names from the 377 engine pack (stock locs carry no authored config).
    const pack = loadLocTypes(ENGINE, 377);
    const locNamesById = new Map<number, string>();
    for (const [debugname, id] of pack.names) {
        const display = pack.configs[id]?.name;
        locNamesById.set(id, display ?? debugname);
    }
    // Loc placements from the packed map squares.
    const locs: LocAt[] = [];
    for (const { mx, mz, loc } of loadMapsquares(ENGINE)) {
        forEachLoc(new Reader(loc), instance => {
            locs.push({ id: instance.locId, x: (mx << 6) + instance.x, z: (mz << 6) + instance.z, level: instance.level });
        });
    }
    // NPC ids from the content pack, wander fields from the unpacked 377 npc configs.
    const idByName = new Map<string, number>();
    for (const line of readFileSync(join(CONTENT, 'pack', 'npc.pack'), 'ascii').split('\n')) {
        const m = /^(\d+)=(.+)$/.exec(line);
        if (m) idByName.set(m[2]!, Number(m[1]));
    }
    const defByName = new Map<string, { name?: string; maxrange?: number; wanderrange?: number }>();
    let current: string | null = null;
    for (const line of readFileSync(join(CONTENT, 'scripts', '_unpack', '377', 'all.npc'), 'utf8').split('\n')) {
        const head = /^\[(.+)\]\s*$/.exec(line);
        if (head) {
            current = head[1];
            defByName.set(current, {});
            continue;
        }
        if (!current) continue;
        const def = defByName.get(current)!;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq);
        const value = line.slice(eq + 1);
        if (key === 'name') def.name = value;
        else if (key === 'maxrange') def.maxrange = Number(value);
        else if (key === 'wanderrange') def.wanderrange = Number(value);
    }
    // Engine defaults for npcs with no authored fields: NpcType.ts:105-106 (wanderrange 5, maxrange wanderrange+2).
    const npcs: NpcAt[] = [];
    const displayById = new Map<number, string>();
    for (const [debugname, id] of idByName) {
        const def = defByName.get(debugname);
        if (def?.name) displayById.set(id, def.name);
    }
    for (const file of readdirSync(join(CONTENT, 'maps'))) {
        const m = /^m(\d+)_(\d+)\.jm2$/.exec(file);
        if (!m) continue;
        const baseX = Number(m[1]) << 6;
        const baseZ = Number(m[2]) << 6;
        const text = readFileSync(join(CONTENT, 'maps', file), 'utf8');
        const section = /^==== NPC ====$([\s\S]*?)(?=^==== |$(?![\s\S]))/m.exec(text);
        if (!section) continue;
        for (const raw of section[1].split('\n')) {
            const spawn = /^(\d) (\d+) (\d+): (\d+)$/.exec(raw.trim());
            if (!spawn) continue;
            const id = Number(spawn[4]);
            const debugname = [...idByName].find(([, i]) => i === id)?.[0];
            const def = debugname ? defByName.get(debugname) : undefined;
            const wanderrange = def?.wanderrange ?? 5;
            const maxrange = def?.maxrange ?? wanderrange + 2;
            npcs.push({
                id,
                x: baseX + Number(spawn[2]),
                z: baseZ + Number(spawn[3]),
                level: Number(spawn[1]),
                maxrange,
                wanderrange,
                display: debugname ? displayById.get(id) ?? debugname : `#${id}`
            });
        }
    }
    cache = { locs, locNamesById, npcs, displayById };
    return cache;
}

describe.skipIf(!engine377 || !content377)('377 placement-derived camp boxes (content-gated)', () => {
    test('mining camps: every declared ore is placed inside the camp box, and near-field ore stays inside', () => {
        const { locs } = load377World();
        const placedByOre = new Map<string, LocAt[]>();
        for (const [ore, ids] of Object.entries(ROCK_TYPES)) {
            const idSet = new Set(ids);
            placedByOre.set(ore.toLowerCase(), locs.filter(l => idSet.has(l.id)));
        }
        // The Shilo gem rocks are the gemrock loc, not a ROCK_TYPES ore.
        placedByOre.set('gem rocks', locs.filter(l => l.id === 2111));
        for (const camp of MINING_LOCATIONS) {
            const radius = DEFAULT_CAMP_RADIUS;
            const inside = (tile: { x: number; z: number }): boolean => cheb(camp.spot.x, camp.spot.z, tile.x, tile.z) <= radius;
            for (const resource of camp.resources) {
                const all = placedByOre.get(resource) ?? [];
                const inBox = all.filter(inside);
                expect(inBox.length > 0, `${camp.name}: no ${resource} placement inside the ${radius}-tile box at ${camp.spot.x},${camp.spot.z}`).toBe(true);
                // A placement outside the box that the bot could never mine from inside is stale data:
                // the box must cover every near-field placement of a declared ore (boundary = radius + 8).
                const outside = all.filter(l => cheb(camp.spot.x, camp.spot.z, l.x, l.z) <= radius + 8 && !inside(l));
                expect(outside, `${camp.name}: ${resource} placements sit just outside the box: ${outside.map(l => `${l.x},${l.z}`).join(' ')}`).toEqual([]);
            }
        }
    });

    test('woodcutting camps: every declared tree type is placed inside the camp box, and near-field trees stay inside', () => {
        const { locs, locNamesById } = load377World();
        const treeNames: Record<string, string[]> = {
            logs: ['Tree'],
            oak: ['Oak'],
            willow: ['Willow'],
            maple: ['Maple tree'],
            yew: ['Yew'],
            magic: ['Magic tree']
        };
        for (const camp of WOODCUTTING_LOCATIONS) {
            const radius = DEFAULT_CAMP_RADIUS;
            const inside = (tile: { x: number; z: number }): boolean => cheb(camp.spot.x, camp.spot.z, tile.x, tile.z) <= radius;
            for (const resource of camp.resources) {
                const names = new Set(treeNames[resource] ?? []);
                const all = locs.filter(l => names.has(locNamesById.get(l.id) ?? ''));
                const inBox = all.filter(inside);
                expect(inBox.length > 0, `${camp.name}: no ${resource} tree placement inside the ${radius}-tile box at ${camp.spot.x},${camp.spot.z}`).toBe(true);
                const outside = all.filter(l => cheb(camp.spot.x, camp.spot.z, l.x, l.z) <= radius + 8 && !inside(l));
                expect(outside, `${camp.name}: ${resource} trees sit just outside the box: ${outside.map(l => `${l.x},${l.z}`).join(' ')}`).toEqual([]);
            }
        }
    });

    test('fishing camps: every spot the camp owns sits inside the camp box', () => {
        const { npcs } = load377World();
        const spots = npcs.filter(n => n.display === 'Fishing spot');
        expect(spots.length > 0, 'the 377 content places no Fishing spot npcs').toBe(true);
        for (const camp of FISHING_LOCATIONS) {
            const radius = camp.campRadius ?? DEFAULT_CAMP_RADIUS;
            const near = spots.filter(n => cheb(camp.spot.x, camp.spot.z, n.x, n.z) <= radius + 8);
            for (const spot of near) {
                // Why: a spot just outside the box is only this camp's miss when no other camp is closer;
                // a neighbour's fishery (the Ardougne castle garden spots near the Seers camp) is not ours.
                const contested = FISHING_LOCATIONS.some(other => {
                    if (other === camp) return false;
                    const otherRadius = other.campRadius ?? DEFAULT_CAMP_RADIUS;
                    return cheb(other.spot.x, other.spot.z, spot.x, spot.z) < cheb(camp.spot.x, camp.spot.z, spot.x, spot.z);
                });
                if (contested) continue;
                expect(cheb(camp.spot.x, camp.spot.z, spot.x, spot.z) <= radius,
                    `${camp.name}: Fishing spot at ${spot.x},${spot.z} sits outside the ${radius}-tile box at ${camp.spot.x},${camp.spot.z}`).toBe(true);
            }
            expect(near.length > 0, `${camp.name}: no Fishing spot placement anywhere near the camp`).toBe(true);
        }
    });

    test('cow fields: the leash keeps a farmed herd, and the documented spawns stay inside it', () => {
        const { npcs } = load377World();
        const cows = npcs.filter(n => n.display === 'Cow');
        const leash = 18; // CowKiller.ts:45 leashRadius default
        for (const field of COW_LOCATIONS) {
            const near = cows.filter(n => cheb(field.anchor.x, field.anchor.z, n.x, n.z) <= leash);
            expect(near.length >= 3, `${field.name}: only ${near.length} Cow spawns inside the ${leash}-tile leash`).toBe(true);
            for (const cow of near) {
                expect(isCowFieldLootTile(field.anchor, leash, { x: cow.x, z: cow.z, level: cow.level }),
                    `${field.name}: spawn ${cow.x},${cow.z} fails the loot leash`).toBe(true);
            }
        }
    });

    test('named script teleports into the desert camp land inside its boxes', () => {
        // The Tourist Trap's own teleports (quest_desertrescue/configs/desertrescue.constant:45-46):
        // ^desertrescue_prison_coord = 0_51_47_21_26 → (3285,3038) surface; ^desertrescue_underground_prison_coord
        // = 0_51_147_24_29 → (3288,9437) underground.
        const surface = MINING_LOCATIONS.find(c => c.name === 'Desert Mining Camp Surface')!;
        const underground = MINING_LOCATIONS.find(c => c.name === 'Desert Mining Camp')!;
        const radius = DEFAULT_CAMP_RADIUS;
        expect(cheb(surface.spot.x, surface.spot.z, 3285, 3038) <= radius).toBe(true);
        expect(cheb(underground.spot.x, underground.spot.z, 3288, 9437) <= radius).toBe(true);
    });
});
