import { describe, expect, test } from 'bun:test';
import stairsJson from '#/bot/event/webwalk/data/stairEdges.json';

interface StairRow {
    from: { x: number; z: number; level: number };
    to: { x: number; z: number; level: number };
    locX?: number;
    locZ?: number;
    debugName?: string;
    disabledReason?: string;
}

const rows = stairsJson as unknown as StairRow[];
const cheb = (ax: number, az: number, bx: number, bz: number): number =>
    Math.max(Math.abs(ax - bx), Math.abs(az - bz));

// A climb-up must be anchored on the tile its own climb-down lands on; teleporting ladders are exempt.
// Why: `derive-ladders.snap()` scans tiles around the loc and can settle on a diagonal the server refuses.
describe('ladder climb-up approaches', () => {
    const downLandings = new Map<string, Set<string>>();
    for (const r of rows) {
        if (r.locX === undefined || r.locZ === undefined || r.to.level >= r.from.level) {
            continue;
        }
        const key = `${r.locX}|${r.locZ}|${r.to.level}`;
        const set = downLandings.get(key) ?? new Set<string>();
        set.add(`${r.to.x}|${r.to.z}`);
        downLandings.set(key, set);
    }

    test('only collision-inoperable landings leave paired climb-up approaches unchanged', () => {
        const wrong: string[] = [];
        for (const r of rows) {
            if (r.locX === undefined || r.locZ === undefined || r.to.level <= r.from.level) {
                continue;
            }
            const landings = downLandings.get(`${r.locX}|${r.locZ}|${r.from.level}`);
            if (!landings || landings.size !== 1) {
                continue;
            }
            const [only] = [...landings];
            const [lx, lz] = only!.split('|').map(Number);
            if (cheb(lx!, lz!, r.locX, r.locZ) > 2) {
                continue; // teleporting ladder, its landing is not the foot
            }
            if (`${r.from.x}|${r.from.z}` !== only) {
                wrong.push(
                    `loc (${r.locX},${r.locZ}) ${r.debugName ?? '?'}: up from (${r.from.x},${r.from.z}) but down lands (${lx},${lz})`
                );
            }
        }
        // pair_up_approaches leaves these rows unchanged only when the 377 collision footprint rejects the script landing as an interaction stand. The exact list is asserted both ways so it cannot grow silently.
        const NOT_OPERABLE_LANDINGS = [
            'loc (2572,3240) scenery_1738: up from (2571,3240) but down lands (2572,3242)',
            'loc (3103,3159) fai_wiztower_spiralstairs: up from (3103,3161) but down lands (3104,3161)',
            'loc (3204,3207) scenery_1738: up from (3203,3209) but down lands (3205,3209)',
            'loc (3204,3229) scenery_1738: up from (3203,3228) but down lands (3205,3228)',
            'loc (3258,3487) scenery_1738: up from (3257,3487) but down lands (3258,3486)',
            'loc (3258,3487) scenery_1739: up from (3257,3487) but down lands (3258,3486)',
            'loc (3010,3516) scenery_1738: up from (3009,3516) but down lands (3010,3515)',
            'loc (3258,3487) scenery_1739: up from (3257,3487) but down lands (3258,3486)',
            'loc (2668,3428) ranging_ladder_up: up from (2668,3429) but down lands (2667,3429)',
            'loc (3042,3379) ladder: up from (3043,3379) but down lands (3042,3380)'
        ];
        expect(wrong).toEqual(NOT_OPERABLE_LANDINGS);
    });

    test('the Seers house ladder that made clue 3507 unsolvable is anchored at its foot', () => {
        const up = rows.find(
            r => r.locX === 2807 && r.locZ === 3454 && r.to.level > r.from.level && !r.disabledReason
        );
        expect(up).toBeDefined();
        expect({ x: up!.from.x, z: up!.from.z }).toEqual({ x: 2808, z: 3454 });
    });
});
