import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';

import doors from '#/bot/event/webwalk/data/doors.json';
import stairs from '#/bot/event/webwalk/data/stairEdges.json';
import transports from '#/bot/event/webwalk/data/transports.json';
import { PathFinder, type DoorEdgeData, type NavPoint, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';

const PACK_PATH = path.join(process.cwd(), 'out/collision.lcnav.gz');
const HAS_COLLISION_PACK = fs.existsSync(PACK_PATH);

function loadFinder(): PathFinder {
    let bytes: Uint8Array = new Uint8Array(fs.readFileSync(PACK_PATH));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = gunzipSync(bytes);
    }
    const built = new PathFinder(bytes);
    built.addEdges(doors as DoorEdgeData[], transports as TransportEdgeData[], stairs as TransportEdgeData[]);
    return built;
}

const finder = HAS_COLLISION_PACK ? loadFinder() : (null as unknown as PathFinder);
const rows = stairs as unknown as TransportEdgeData[];

/**
 * The chest room upstairs in eastern Falador is named by `trail_coord,1_47_52_33_36` (377 `all.obj:41708`).
 * Its `scenery_11732` stair handler only calls `@unhandled_stairs` (`ladders+stairs/scripts/stairs.rs2:1101-1105`), so no movement edge can be derived.
 */
const CHEST: NavPoint = { x: 3041, z: 3364, level: 1 };
const FALADOR_EAST_BANK: NavPoint = { x: 3013, z: 3355, level: 0 };
/** The staircase placement whose script is unhandled. */
const STAIRS: NavPoint = { x: 3034, z: 3363, level: 0 };

// The server accepts a Climb from a tile cardinally beside the loc with no wall between the two.
const SIDES: readonly [number, number, number][] = [
    [0, 1, 1 << 2],
    [1, 0, 1 << 3],
    [0, -1, 1 << 0],
    [-1, 0, 1 << 1]
];

function footprint(p: NavPoint): NavPoint[] {
    if (finder.walkable(p.x, p.z, p.level)) {
        return [];
    }
    const seen = new Set<string>([`${p.x},${p.z}`]);
    const solid = [p];
    const stack = [p];
    while (stack.length > 0) {
        const cur = stack.pop()!;
        for (const [dx, dz] of SIDES) {
            const nx = cur.x + dx;
            const nz = cur.z + dz;
            // A straight staircase spans up to three tiles from its placement tile (loc 11724 is 1x3), so the solid footprint is searched two tiles out.
            if (Math.max(Math.abs(nx - p.x), Math.abs(nz - p.z)) > 2) {
                continue;
            }
            if (seen.has(`${nx},${nz}`) || finder.walkable(nx, nz, p.level)) {
                continue;
            }
            seen.add(`${nx},${nz}`);
            const tile = { x: nx, z: nz, level: p.level };
            solid.push(tile);
            stack.push(tile);
        }
    }
    return solid;
}

function operableTiles(p: NavPoint): Set<string> {
    const tiles = new Set<string>();
    for (const solid of footprint(p)) {
        for (const [dx, dz, facingWall] of SIDES) {
            const cx = solid.x + dx;
            const cz = solid.z + dz;
            if (finder.walkable(cx, cz, p.level) && (finder.wallMask(cx, cz, p.level) & facingWall) === 0) {
                tiles.add(`${cx},${cz}`);
            }
        }
    }
    return tiles;
}


const isLadder = (e: TransportEdgeData): boolean => /ladder/i.test(e.debugName ?? e.locName);

describe('eastern Falador house staircase', () => {
    test('does not invent movement for the unhandled 377 location script', () => {
        const edges = rows.filter(e => e.locId === 11732 && e.locX === STAIRS.x && e.locZ === STAIRS.z);
        expect(edges).toEqual([]);
    });
});

describe.skipIf(!HAS_COLLISION_PACK)('eastern Falador house routing', () => {
    test('does not route to the upstairs chest through the unhandled staircase', () => {
        const route = finder.findPath(FALADOR_EAST_BANK, CHEST, undefined, 4_000_000);
        expect(route.ok).toBe(false);
    });

    test('no staircase is anchored on the far side of its own wall', () => {
        const walledOff = rows
            .filter(e => e.kind === 'stair' && !e.disabledReason && !isLadder(e) && e.locX !== undefined && e.locZ !== undefined)
            .filter(e => Math.max(Math.abs(e.locX! - e.from.x), Math.abs(e.locZ! - e.from.z)) <= 2)
            .filter(e => {
                const operable = operableTiles({ x: e.locX!, z: e.locZ!, level: e.from.level });
                return operable.size > 0 && !operable.has(`${e.from.x},${e.from.z}`);
            })
            .map(e => `${e.debugName ?? e.locName} (${e.locX},${e.locZ},L${e.from.level}) climbed from (${e.from.x},${e.from.z})`);
        expect(walledOff).toEqual([]);
    });
});
