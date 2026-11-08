import Tile from '../../../../geometry/Tile.js';
import type { NpcStop } from '../exec/primitives.js';
import { gatherWool, type WoolSites } from '../exec/wool.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

const FRED: NpcStop = {
    npc: 'Fred the Farmer', anchor: new Tile(3189, 3273, 0), leash: 6,
    prefer: [
        "I'm looking for a quest.",
        'Yes okay. I can do that.',
        // 377 content: fred_the_farmer.rs2:86,93,140.
        'Of course!',
        "I'm something of an expert actually!"
    ],
    // 377 content: fred_the_farmer.rs2:211-234 has a 19-ball, one-per-tick hand-in loop.
    gapMs: 25_000
};
const BALLS_NEEDED = 20;

const SITES: WoolSites = {
    pen: new Tile(3197, 3266, 0),
    // 377 content: M:m50_50.jm2:9464 places the wheel at (3209,3212,L1).
    wheelStand: new Tile(3209, 3213, 1),
    // 377 content: M:m49_51.jm2:7424 places shears at (3192,3272).
    shearsSpawn: new Tile(3192, 3272, 0),
    // 377 content: fred_the_farmer.rs2:152 directs the player to Lumbridge Castle.
    spinLabel: 'spin wool at Lumbridge'
};

export function gatherBalls(snap: QuestSnapshot, need: number): QuestStep {
    return gatherWool(snap, need, SITES);
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: FRED }; }
    if ((snap.inv.get('ball of wool') ?? 0) > 0) {
        return { kind: 'talk', stop: FRED };
    }
    return gatherBalls(snap, BALLS_NEEDED);
}

export const sheepshearer: QuestModule = {
    record: QUESTS.find(r => r.id === 'sheep')!,
    bank: new Tile(3093, 3243, 0),
    coinFloat: 0,
    tools: ['shears', 'wool'],
    gather: { 'ball of wool': gatherBalls },
    decide
};
