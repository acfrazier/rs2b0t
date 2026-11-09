import { Execution } from '../../../execution/Execution.js';
import { GameMessages } from '../../../chatbox/gameMessages.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Locs } from '../../../locs/Locs.js';
import { Traversal } from '../../../walking/Traversal.js';
import Tile from '../../../../geometry/Tile.js';
import type { NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

const COOK: NpcStop = { npc: 'Cook', anchor: new Tile(3209, 3215, 0), leash: 6, prefer: ["What's wrong?", "Yes, I'll help you."] };
const EGG_PEN = new Tile(3227, 3300, 0);
const FARMHOUSE_BUCKET = new Tile(3225, 3294, 0);
// 377 (content cb6cc5ea1): milk comes from the Dairy Cow loc 8689 `fat_cow` (cow_milking.rs2:35-51); the Cow NPC refuses a bucket (:1-5). Spawns (3252,3275) and (3254,3272), maps/m50_51.jm2:7329,7397.
const DAIRY_COWS = new Tile(3253, 3274, 0);
const WHEAT_FIELD = new Tile(3158, 3300, 0);
// maps/m50_50.jm2:10731 `0 9 14: 1931`.
const POT_SPAWN = new Tile(3209, 3214, 0);
/** pickables.rs2:25-32 binds Pick only for wheat 313, wheat_small 5584 and wheat_smallest 5585; wheat_tall 5583 shares the name and op but has no handler. */
const PICKABLE_WHEAT = new Set([313, 5584, 5585]);
const MILL_TOP = new Tile(3166, 3306, 2);
const MILL_BASE = new Tile(3166, 3306, 0);

const GRAIN_LOADED = /you put the grain in the hopper|there is already grain in the hopper/i;
const GRAIN_GROUND = /the grain slides down the chute/i;
const HOPPER_EMPTY = /you operate the empty hopper/i;
const BIN_ALREADY_FULL = /flour bin downstairs is full, i should empty/i;

/** Locs read blank for about a tick after a level change. */
function sceneHas(name: string): Promise<boolean> {
    return Execution.delayUntil(() => Locs.query().name(name).within(8).exists(), 6000);
}

async function pickGrain(log: (m: string) => void): Promise<boolean> {
    const wheat = () => Locs.query().name('Wheat').action('Pick').where(loc => PICKABLE_WHEAT.has(loc.id)).within(10).nearest();
    if (!wheat() && !(await Traversal.walkResilient(WHEAT_FIELD, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    const target = wheat();
    if (!target) {
        log('no pickable Wheat near the field');
        return false;
    }
    const before = Inventory.count('Grain');
    if (!(await target.interact('Pick'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.count('Grain') > before, 8000);
}

async function fillHopper(log: (m: string) => void): Promise<boolean> {
    const grain = Inventory.first('Grain');
    if (!grain) {
        return true;
    }
    const hopper = Locs.query().name('Hopper').within(8).nearest();
    if (!hopper) {
        log('no Hopper on the mill top floor');
        return false;
    }
    const mark = GameMessages.mark();
    log('putting the grain in the hopper');
    if (!(await grain.useOn(hopper))) {
        return false;
    }
    // Why: the grain leaves the pack before the server walks us to the hopper, so only the closing message means the fill is done; acting on the pack sends the next op mid-walk, where it's dropped.
    return Execution.delayUntil(() => GameMessages.sawSince(mark, GRAIN_LOADED), 20_000);
}

type Grind = 'ground' | 'binFull' | 'failed';

async function grindHopper(log: (m: string) => void): Promise<Grind> {
    const controls = Locs.query().name('Hopper controls').action('Operate').within(8).nearest();
    if (!controls) {
        log('no Hopper controls on the top floor');
        return 'failed';
    }
    const mark = GameMessages.mark();
    log('operating the hopper controls to grind the flour');
    if (!(await controls.interact('Operate'))) {
        return 'failed';
    }
    const settled = await Execution.delayUntil(
        () =>
            GameMessages.sawSince(mark, GRAIN_GROUND) ||
            GameMessages.sawSince(mark, BIN_ALREADY_FULL) ||
            GameMessages.sawSince(mark, HOPPER_EMPTY),
        20_000
    );
    if (!settled) {
        log('the hopper controls never answered');
        return 'failed';
    }
    if (GameMessages.sawSince(mark, GRAIN_GROUND)) {
        return 'ground';
    }
    if (GameMessages.sawSince(mark, BIN_ALREADY_FULL)) {
        log('the flour bin is already full downstairs');
        return 'binFull';
    }
    log('the hopper was still empty when the controls were pulled');
    return 'failed';
}

async function millFlour(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(MILL_TOP, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    if (!(await sceneHas('Hopper controls'))) {
        log('the mill top floor has not loaded');
        return false;
    }
    if (!(await fillHopper(log))) {
        return false;
    }
    if ((await grindHopper(log)) === 'failed') {
        return false;
    }
    log('heading down to the flour bin');
    if (!(await Traversal.walkResilient(MILL_BASE, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    if (!(await sceneHas('Flour bin'))) {
        log('the mill ground floor has not loaded');
        return false;
    }
    const bin = Locs.query().name('Flour bin').action('Empty').within(8).nearest();
    if (!bin || !(await bin.interact('Empty'))) {
        return false;
    }
    log('emptying the flour bin into the pot');
    return Execution.delayUntil(() => Inventory.contains('Pot of flour'), 15_000);
}

export function gatherFlour(snap: QuestSnapshot): QuestStep {
    if (!snap.inv.has('pot')) {
        return { kind: 'grabGround', item: 'Pot', anchor: POT_SPAWN };
    }
    if (!snap.inv.has('grain')) {
        return { kind: 'custom', name: 'pick grain', run: pickGrain };
    }
    return { kind: 'custom', name: 'mill flour', run: millFlour };
}

export function gatherMilk(snap: QuestSnapshot): QuestStep {
    if (!snap.inv.has('bucket')) {
        return { kind: 'grabGround', item: 'Bucket', anchor: FARMHOUSE_BUCKET };
    }
    return { kind: 'useOn', item: 'Bucket', targetKind: 'loc', target: 'Dairy Cow', anchor: DAIRY_COWS, product: 'Bucket of milk' };
}

const gatherEgg = (): QuestStep => ({ kind: 'grabGround', item: 'Egg', anchor: EGG_PEN, waitIfMissing: true });

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: COOK }; }
    if (!snap.inv.has('egg')) { return gatherEgg(); }
    if (!snap.inv.has('bucket of milk')) { return gatherMilk(snap); }
    if (!snap.inv.has('pot of flour')) { return gatherFlour(snap); }
    return { kind: 'talk', stop: COOK };
}

export const cooksassistant: QuestModule = {
    record: QUESTS.find(r => r.id === 'cook')!,
    bank: new Tile(3093, 3243, 0),
    coinFloat: 0,
    tools: ['pot', 'grain', 'bucket', 'egg'],
    gather: {
        'egg': gatherEgg,
        'bucket of milk': gatherMilk,
        'pot of flour': gatherFlour
    },
    decide
};
