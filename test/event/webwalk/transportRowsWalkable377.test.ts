import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';

import { PathFinder, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import { activateTransportRows } from '#/bot/event/webwalk/activateStateAware.js';
import stairs from '#/bot/event/webwalk/data/stairEdges.json';
import { allDoorRows, allTransportRows } from '#/bot/event/webwalk/loadTransportGraph.js';

const PACK_PATH = path.join(process.cwd(), 'out/collision.lcnav.gz');

// Why: PathFinder.addEdges drops a row whose stand or landing tile is not walkable in the pack, so a row that points at a blocked tile vanishes from every route without any failure; this test turns each silent drop into a named failure.
describe.skipIf(!fs.existsSync(PACK_PATH))('377 nav rows that the pack would silently drop', () => {
    const finder = new PathFinder(new Uint8Array(gunzipSync(new Uint8Array(fs.readFileSync(PACK_PATH)))));

    test('every active transport and stair row stands and lands on a walkable tile', () => {
        const active = activateTransportRows([...allTransportRows(), ...(stairs as TransportEdgeData[])]).filter(edge => !edge.disabledReason && edge.blacklist !== true);
        expect(active.length).toBeGreaterThan(1000);
        const dropped = active
            .filter(edge => !finder.walkable(edge.from.x, edge.from.z, edge.from.level) || !finder.walkable(edge.to.x, edge.to.z, edge.to.level))
            .map(edge => `${edge.debugName ?? edge.locName} ${edge.locId} ${edge.from.x},${edge.from.z},${edge.from.level} -> ${edge.to.x},${edge.to.z},${edge.to.level}`);
        expect(dropped).toEqual([]);
    });

    // Each row below is a 377 placement whose far or own tile is blocked in the 377 map itself (void ground beside the door, a dead tree or a crate on the doorstep), not a nav-data fault; the list is asserted both ways so it cannot go stale.
    const BLOCKED_IN_377 = new Set([
        '1536 1861,5340,0 S', '1519 1868,5347,0 E', '1516 1868,5348,0 E', '1516 2009,4747,0 N', '1519 2010,4747,0 N',
        '1530 2487,3301,0 E', '1530 3302,3503,0 E'
    ]);

    test('every door row has both stand tiles walkable except the doors 377 itself blocks', () => {
        const step = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] } as Record<string, [number, number]>;
        const dropped = allDoorRows()
            .filter(door => {
                const [dx, dz] = step[door.dir] ?? [0, 0];
                return !finder.walkable(door.x, door.z, door.level) || !finder.walkable(door.x + dx, door.z + dz, door.level);
            })
            .map(door => `${door.locId} ${door.x},${door.z},${door.level} ${door.dir}`);
        expect(new Set(dropped)).toEqual(BLOCKED_IN_377);
    });
});
