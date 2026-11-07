import fs from 'node:fs';

import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';

import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';

const PACK = 'out/collision.lcnav.gz';

// 377 pack/loc.pack:11993-11994: the ground-floor inner door is `fai_wiztower_poor_door` (11993, open twin 11994); the 289 door 1536 is not this crossing at 377.
// The door sits on an unwalkable midpoint, so the crossing is the 2-tile hop between 3106 and 3108.
describe.skipIf(!fs.existsSync(PACK))("Wizards' Tower inner door", () => {
    const finder = fs.existsSync(PACK) ? new PathFinder(gunzipSync(fs.readFileSync(PACK))) : null;
    if (finder) loadDefaultNavEdges(finder);

    test.each([
        [3106, 3108],
        [3108, 3106]
    ])('a route from %i to %i crosses with the 377 door hop and no 289 door id', (fromX, toX) => {
        const route = finder!.findPath({ x: fromX, z: 3162, level: 0 }, { x: toX, z: 3162, level: 0 });
        expect(route.ok).toBe(true);
        if (!route.ok) return;
        const crossing = route.hops.filter(hop => hop.from.x === fromX && hop.to.x === toX && hop.from.z === 3162);
        expect(crossing.map(hop => hop.locId)).toEqual([11993]);
    });
});
