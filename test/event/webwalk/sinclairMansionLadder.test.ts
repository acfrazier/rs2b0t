import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';

import doors from '#/bot/event/webwalk/data/doors.json';
import stairs from '#/bot/event/webwalk/data/stairEdges.json';
import transports from '#/bot/event/webwalk/data/transports.json';
import { PathFinder, type DoorEdgeData, type NavPoint, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import { TALK_ANCHORS } from '#/bot/api/ai/clues/data/talkAnchors.js';

// The pack is a build artifact, not a committed file, so CI runs without it.
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

const ARDOUGNE_BANK: NavPoint = { x: 2655, z: 3286, level: 0 };
/** trail_clue_medium_anagram009, Donovan the Family Handyman, upstairs. */
const DONOVAN_CLUE = 2855;

// The pre-289 fixture does not carry over: the 377 collision pack marks this tile unwalkable.
describe.skipIf(!HAS_COLLISION_PACK)('Sinclair Mansion ladder', () => {
    test('the 377 collision pack marks the former stranded tile unwalkable', () => {
        const formerFixtureTile: NavPoint = { x: 2737, z: 3583, level: 0 };
        expect(finder.walkable(formerFixtureTile.x, formerFixtureTile.z, formerFixtureTile.level)).toBe(false);
    });

    test('no stair edge anchors its approach on the sealed strip', () => {
        const onStrip = (stairs as TransportEdgeData[]).filter(e => e.from.level === 0 && e.from.z === 3583 && e.from.x >= 2730 && e.from.x <= 2751);
        expect(onStrip).toEqual([]);
    });

    test('Donovan is reachable, so the anagram clue can be solved', () => {
        const donovan = TALK_ANCHORS[DONOVAN_CLUE];
        expect(donovan).toBeDefined();
        expect({ x: donovan.x, z: donovan.z, level: donovan.level }).toEqual({ x: 2745, z: 3576, level: 1 });
        const route = finder.findPath(ARDOUGNE_BANK, { x: donovan.x, z: donovan.z, level: donovan.level }, undefined, 4_000_000);
        expect(route.ok).toBe(true);
    });
});
