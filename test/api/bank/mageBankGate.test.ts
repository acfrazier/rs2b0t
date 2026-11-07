import { afterEach, describe, expect, test } from 'bun:test';

import { BANK_LOCATIONS, USE_MAGE_BANK, bankUnlocked, nearestBank } from '#/bot/api/bank/BankLocations.js';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';

const PACK = 'out/collision.lcnav.gz';

const MAGE = BANK_LOCATIONS.find(b => b.name === 'Mage Arena')!;
const KEY = `rs2b0t:set:Global:${USE_MAGE_BANK}`;

/** Beside the lever in deep Wilderness. Gundai is nearest by far. */
const DEEP_WILDERNESS = { x: 3091, z: 3958, level: 0 };

function setSetting(on: boolean | null): void {
    if (on === null) {
        localStorage.removeItem(KEY);
        sessionStorage.removeItem(KEY);
        return;
    }
    localStorage.setItem(KEY, String(on));
}

afterEach(() => setSetting(null));

describe('Mage Arena bank gate', () => {
    test.skipIf(!existsSync(PACK))('the navigation graph walks from the webs to the cellar bank: two webs, then the lever', () => {
        const finder = new PathFinder(gunzipSync(readFileSync(PACK)));
        loadDefaultNavEdges(finder);
        const state = { ...emptyWorldStateData(true), canSlashWeb: true };
        const route = finder.findPath({ x: 3098, z: 3957, level: 0 }, { x: MAGE.tile.x, z: MAGE.tile.z, level: 0 }, { state, useTeleportCatalog: false });
        expect(route.ok).toBe(true);
        if (!route.ok) return;
        expect(route.hops.map(hop => `${hop.locName}:${hop.action}`)).toEqual(['Web:Slash', 'Web:Slash', 'Lever:Pull']);
        expect(route.waypoints.at(-1)).toMatchObject({ x: MAGE.tile.x, z: MAGE.tile.z });
    });

    test('off by default, so nothing routes through the Wilderness to bank', () => {
        expect(bankUnlocked(MAGE)).toBe(false);
        const near = nearestBank(DEEP_WILDERNESS);
        expect(near?.name).not.toBe('Mage Arena');
    });

    test('stays off when the setting is explicitly false', () => {
        setSetting(false);
        expect(bankUnlocked(MAGE)).toBe(false);
        expect(nearestBank(DEEP_WILDERNESS)?.name).not.toBe('Mage Arena');
    });

    test('opting in makes it selectable, and it wins from inside the Wilderness', () => {
        setSetting(true);
        expect(bankUnlocked(MAGE)).toBe(true);
        expect(nearestBank(DEEP_WILDERNESS)?.name).toBe('Mage Arena');
    });

    test('even opted in, an Ardougne bot still banks in Ardougne', () => {
        setSetting(true);
        const ardy = nearestBank({ x: 2616, z: 3332, level: 0 });
        expect(ardy?.name).toBe('Ardougne West');
    });
});
