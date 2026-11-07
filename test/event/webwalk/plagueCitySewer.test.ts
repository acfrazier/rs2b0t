import { describe, expect, test } from 'bun:test';

import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { emptyWorldStateData, type WorldStateData } from '#/bot/event/webwalk/worldStateData.js';

// 377 quest_elena.constant:23-26: the open pipe at 2514,9737 is entered from 2514,9739, the mud patch drops to 2518,9760 beside the mud pile, the manhole lands at 2529,3304 and the pile climbs to the garden at 2566,3331.
const SEWER = { x: 2514, z: 9739, level: 0 };
const CITY = { x: 2529, z: 3304, level: 0 };
const MUD_PILE = { x: 2518, z: 9760, level: 0 };
const GARDEN = { x: 2566, z: 3330, level: 0 };

function route(state: WorldStateData, from = SEWER, to = CITY): boolean {
    // One walkable bit per tile, grouped by map square: the sewer stand and the mud-pile landing share square 39,152.
    const squares = new Map<string, { mx: number; mz: number; tiles: { x: number; z: number }[] }>();
    for (const tile of [SEWER, CITY, MUD_PILE, GARDEN]) {
        const key = `${tile.x >> 6},${tile.z >> 6}`;
        const square = squares.get(key) ?? { mx: tile.x >> 6, mz: tile.z >> 6, tiles: [] };
        square.tiles.push(tile);
        squares.set(key, square);
    }
    const size = 3 + 4096 + 512;
    const pack = new Uint8Array(10 + squares.size * size);
    pack.set([0x4c, 0x43, 0x4e, 0x56, 1, 1, 0, 0, squares.size, 0]);
    for (const [i, square] of [...squares.values()].entries()) {
        const offset = 10 + i * size;
        pack.set([square.mx, square.mz, 1], offset);
        for (const tile of square.tiles) {
            const index = (tile.x & 63) * 64 + (tile.z & 63);
            pack[offset + 3 + 4096 + (index >> 3)] |= 1 << (index & 7);
        }
    }
    const finder = new PathFinder(pack);
    loadDefaultNavEdges(finder);
    return finder.findPath(from, to, { state }).ok;
}

describe('West Ardougne sewer route', () => {
    test('wearing the only Gas mask opens the pipe after starting Plague City', () => {
        expect(route({
            ...emptyWorldStateData(),
            quests: { 'Plague City': 'started' },
            worn: { 'Gas mask': 1 }
        })).toBe(true);
    });

    test('carrying a Gas mask without wearing it does not open the pipe', () => {
        expect(route({
            ...emptyWorldStateData(),
            quests: { 'Plague City': 'complete' },
            items: { 'Gas mask': 1 }
        })).toBe(false);
    });

    test('masks do not replace the Plague City requirement', () => {
        expect(route({
            ...emptyWorldStateData(),
            items: { 'Gas mask': 1 },
            worn: { 'Gas mask': 1 }
        })).toBe(false);
    });

    test('the mud pile returns to a walkable garden stand beside the blocked patch', () => {
        expect(route(emptyWorldStateData(), MUD_PILE, GARDEN)).toBe(true);
    });
});
