import { Execution } from '../../../execution/Execution.js';
import { Reachability } from '../../../../event/webwalk/geometry/Reachability.js';
import type Tile from '../../../../geometry/Tile.js';
import { Traversal } from '../../../walking/Traversal.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Locs } from '../../../locs/Locs.js';
import { Npcs } from '../../../npcs/Npcs.js';
import type { QuestSnapshot, QuestStep } from '../engine/types.js';

export const UNSHEARED_SHEEP_ID = 43;
// 377 content: shear_sheep.rs2:5-24, :26-44, and :46-64 shear IDs 43, 1763, and 1765; The Thing 3579 uses :80-96.
const SHEARABLE_SHEEP_IDS: ReadonlySet<number> = new Set([UNSHEARED_SHEEP_ID, 1763, 1765]);

export function isShearableSheep(id: number): boolean {
    return SHEARABLE_SHEEP_IDS.has(id);
}

export interface WoolSites {
    pen: Tile;
    wheelStand: Tile;
    shearsSpawn: Tile;
    spinLabel: string;
}

async function shearOne(pen: Tile, log: (m: string) => void): Promise<boolean> {
    const before = Inventory.count('Wool');
    const sheep = Npcs.query()
        .name('Sheep')
        .within(8)
        .where(n => isShearableSheep(n.id) && Reachability.canReach(n.tile(), { adjacentOk: true }))
        .nearest();
    if (!sheep) {
        await Traversal.walkResilient(pen, { radius: 2, attempts: 2, timeoutMs: 60_000, log });
        return false;
    }
    const shears = Inventory.first('Shears');
    log('shearing a sheep for its wool');
    if (!shears || !(await shears.useOn(sheep))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.count('Wool') > before, 6000);
}

/** @see docs/decisions/level-change-lag.md, a wheel on an upper floor reads empty for a tick. */
async function spinAllWool(wheelStand: Tile, log: (m: string) => void): Promise<boolean> {
    const startingBalls = Inventory.count('Ball of wool');
    if (Inventory.count('Wool') === 0) {
        return false;
    }
    const wheel = Locs.query().name('Spinning wheel').within(8).nearest();
    if (!wheel) {
        await Traversal.walkResilient(wheelStand, { radius: 2, attempts: 3, timeoutMs: 300_000, log });
        await Execution.delayTicks(2);
        return false;
    }
    while (Inventory.count('Wool') > 0) {
        const woolBefore = Inventory.count('Wool');
        const ballsBefore = Inventory.count('Ball of wool');
        const wool = Inventory.first('Wool');
        log('using wool on the spinning wheel');
        if (!wool || !(await wool.useOn(wheel))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => Inventory.count('Ball of wool') > ballsBefore, 15_000))) {
            log('wool use on the spinning wheel produced no ball of wool');
            return false;
        }
        if (Inventory.count('Wool') !== woolBefore - 1 || Inventory.count('Ball of wool') !== ballsBefore + 1) {
            log('spinning wheel did not consume exactly one wool for one ball');
            return false;
        }
        // 377 content: spinning.rs2:57-64 gives the ball, then p_delay(3). In the L2 trial a use sent three client ticks after the ball appeared
        // never produced a ball, so every step attempt spun one ball and timed out; wait out the delay with two ticks to spare.
        await Execution.delayTicks(5);
    }
    return Inventory.count('Ball of wool') > startingBalls;
}

export function gatherWool(snap: QuestSnapshot, need: number, sites: WoolSites): QuestStep {
    if ((snap.inv.get('wool') ?? 0) >= need) {
        return { kind: 'custom', name: sites.spinLabel, run: log => spinAllWool(sites.wheelStand, log) };
    }
    if (!snap.inv.has('shears')) {
        return { kind: 'grabGround', item: 'Shears', anchor: sites.shearsSpawn };
    }
    return { kind: 'custom', name: 'shear a sheep', run: log => shearOne(sites.pen, log) };
}
