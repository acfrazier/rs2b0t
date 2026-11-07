import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';

import transports from '#/bot/event/webwalk/data/transports.json';
import { PathFinder, type NavPoint, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { richTransportQuestMap } from '#/bot/event/webwalk/transportQuestReqs.js';
import { emptyWorldStateData, type WorldStateData } from '#/bot/event/webwalk/worldStateData.js';

/**
 * The Ogre city dig tile (2542,3031): the 289 trail_clue_hard_sextant024 spot (04 degrees 03 minutes South, 03 degrees 11 minutes East).
 * 377 trail_hard.enum lists only sextant001-013, so the clue is never dispensed; the tile is still on the 377 map, which is what this routes to.
 */
const OGRE_CITY_DIG: NavPoint = { x: 2542, z: 3031, level: 0 };
const CATHERBY: NavPoint = { x: 2725, z: 3491, level: 0 };

const rows = transports as unknown as TransportEdgeData[];
const battlements = rows.filter(e => e.debugName === 'ganothbattlement');

// Why: two `ganothbattlement` placements stand at (2507,3011) and (2507,3012), each 1x1 and blocking,
// Why: and `oploc1` climbs the player to the tile on the far side of whichever one they clicked.
describe("the Gu'Tanoth battlement", () => {
    test('both placements cross in both directions', () => {
        const pairs = battlements
            .map(e => `${e.from.x},${e.from.z} -> ${e.to.x},${e.to.z}`)
            .sort();
        expect(pairs).toEqual([
            '2506,3011 -> 2508,3011',
            '2506,3012 -> 2508,3012',
            '2508,3011 -> 2506,3011',
            '2508,3012 -> 2506,3012'
        ]);
    });

    test('every crossing is quest-gated, in both directions', () => {
        expect(battlements).toHaveLength(4);
        for (const e of battlements) {
            expect(e.requires?.quests, `${e.from.x},${e.from.z}`).toEqual([{ quest: 'Watch Tower', minStatus: 'complete' }]);
            expect(e.locId).toBe(2832);
            expect(e.action).toBe('Climb-over');
        }
    });

    test('the stand tiles are the loc placements, one tile either side', () => {
        for (const e of battlements) {
            expect(e.locX).toBe(2507);
            expect([3011, 3012]).toContain(e.locZ!);
            expect(Math.abs(e.from.x - e.locX!)).toBe(1);
            expect(e.from.z).toBe(e.locZ!);
        }
    });
});

const PACK_PATH = path.join(process.cwd(), 'out/collision.lcnav.gz');
const HAS_COLLISION_PACK = fs.existsSync(PACK_PATH);

function loadFinder(): PathFinder {
    let bytes: Uint8Array = new Uint8Array(fs.readFileSync(PACK_PATH));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = new Uint8Array(gunzipSync(bytes));
    }
    const finder = new PathFinder(bytes);
    loadDefaultNavEdges(finder);
    return finder;
}

const SKILLS = Object.fromEntries(
    ['agility', 'attack', 'strength', 'defence', 'hitpoints', 'magic'].map(s => [s, 99])
);

function kitted(quests: boolean): WorldStateData {
    return {
        ...emptyWorldStateData(),
        members: true,
        skills: SKILLS,
        quests: quests ? richTransportQuestMap() : {},
        items: { Coins: 100_000, Spade: 1 },
        freeSlots: 14
    };
}

describe.skipIf(!HAS_COLLISION_PACK)('the ogre city dig', () => {
    test('routes over the gate, the battlement and the chasm, in that order', () => {
        const route = loadFinder().findPath(CATHERBY, OGRE_CITY_DIG, { state: kitted(true), useTeleportCatalog: false });
        expect(route.ok).toBe(true);
        if (!route.ok) {
            return;
        }
        expect(route.hops.filter(h => h.kind !== 'walk').map(h => `${h.kind}:${h.locName}`)).toEqual([
            'door:City gate',
            'shortcut:Battlement',
            'shortcut:Rock'
        ]);
    }, 120_000);

    // Why: `oploc1,ganothbattlement` reads the market bits, which only a Watch Tower account has set, so the
    // Why: route has to be pruned at plan time rather than walked to a wall the guard will not let it over.
    test('an account without Watch Tower is not routed there at all', () => {
        expect(loadFinder().findPath(CATHERBY, OGRE_CITY_DIG, { state: kitted(false), useTeleportCatalog: false }).ok).toBe(false);
    }, 120_000);
});
