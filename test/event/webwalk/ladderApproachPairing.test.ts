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
// ReachStrategy, rather than the paired down landing alone, determines a stair's final interaction tile.
describe('ladder climb-up approaches', () => {

    test('the Seers house ladder that made clue 3507 unsolvable is anchored at its foot', () => {
        const up = rows.find(
            r => r.locX === 2807 && r.locZ === 3454 && r.to.level > r.from.level && !r.disabledReason
        );
        expect(up).toBeDefined();
        expect({ x: up!.from.x, z: up!.from.z }).toEqual({ x: 2808, z: 3454 });
    });
});
