import { Execution } from '../../../execution/Execution.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { GroundItems } from '../../../grounditems/GroundItems.js';
import { Locs } from '../../../locs/Locs.js';
import { Npcs } from '../../../npcs/Npcs.js';
import { ChatDialog } from '../../../ui/dialogue/ChatDialog.js';
import Tile from '../../../../geometry/Tile.js';
import { driveDialog, talkThrough, walkWithHops, type NpcStop } from '../exec/primitives.js';
import { bankedId, heldId, type QuestModule, type QuestSnapshot, type QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';
import { WIZARD_HOPS } from './runemysteries.js';

const AMULET = 'Ghostspeak amulet';
const AMULET_ID = 552;
// 377 (content cb6cc5ea1): the quest skull is obj `ghostskull`, id 553 (pack/obj.pack:554). The generic obj `skull`, id 964 (pack/obj.pack:965), has the same name and examine text and spawns elsewhere, so only the id tells them apart.
const SKULL_ID = 553;
const DRAYNOR_BANK = new Tile(3093, 3243, 0);

const AERECK: NpcStop = { npc: 'Father Aereck', anchor: new Tile(3244, 3206, 0), leash: 6, prefer: ["I'm looking for a quest!"] };
const URHNEY: NpcStop = {
    npc: 'Father Urhney', anchor: new Tile(3235, 3154, 0), leash: 6,
    prefer: ['Father Aereck sent me to talk to you.', "He's got a ghost haunting his graveyard.", "I've lost the amulet."]
};
const GHOST_PREFER = ['Yep, now tell me what the problem is.'];
const COFFIN_STAND = new Tile(3250, 3193, 0);
const SKULL_TILE = new Tile(3120, 9565, 0);

async function ensureCoffinOpen(_log: (m: string) => void): Promise<void> {
    const shut = Locs.query().name('Coffin').action('Open').within(6).nearest();
    if (shut) {
        await shut.interact('Open');
        // 377 content: quest_priest.rs2:6-14 walks up (p_arrivedelay), spawns the ghost, p_delay(0), then loc_change to the open form
        // (restless_ghost_altar, op1=Close); a fixed two ticks ended before that in the L2 trial, so wait for the open form.
        await Execution.delayUntil(() => Locs.query().name('Coffin').action('Close').within(6).exists(), 8000);
    }
}

async function grabSkull(log: (m: string) => void): Promise<boolean> {
    const altarSkull = () => GroundItems.query().where(item => item.id === SKULL_ID).within(10).nearest();
    for (let cycle = 0; cycle < 10; cycle++) {
        const skull = altarSkull();
        if (skull) {
            await skull.interact('Take');
            if (await Execution.delayUntil(() => Inventory.countById(SKULL_ID) > 0, 8000)) {
                return true;
            }
            log('lost the skull to another quester — waiting for it to respawn');
        } else {
            log('altar skull already taken — waiting for the shared spawn to respawn');
        }
        await Execution.delayUntil(() => !!altarSkull(), 70000);
    }
    log('altar skull never returned — re-entering to re-check the ghost trip');
    return false;
}

async function ghostAndSkull(log: (m: string) => void): Promise<boolean> {
    if (!(await walkWithHops(COFFIN_STAND, 2, WIZARD_HOPS, log))) {
        return false;
    }
    await ensureCoffinOpen(log);
    if (!Npcs.query().name('Restless ghost').within(8).nearest()) {
        log('no ghost after opening the coffin — re-check next loop');
        return false;
    }
    if (!(await talkThrough('Restless ghost', GHOST_PREFER, log))) {
        return false;
    }
    if (!(await walkWithHops(SKULL_TILE, 2, WIZARD_HOPS, log))) {
        return false;
    }
    return grabSkull(log);
}

async function returnSkull(log: (m: string) => void): Promise<boolean> {
    if (!(await walkWithHops(COFFIN_STAND, 2, WIZARD_HOPS, log))) {
        return false;
    }
    await ensureCoffinOpen(log);
    const coffin = Locs.query().name('Coffin').within(6).nearest();
    const skull = Inventory.items().find(item => item.id === SKULL_ID);
    if (!coffin || !skull) {
        return false;
    }
    if (!(await skull.useOn(coffin))) {
        return false;
    }
    // 377 quest_priest.rs2:55-63: ~mesbox("You put the skull in the coffin.") pauses on p_pausebutton before inv_del (:56), so the skull leaves the pack only after a Continue; "The ghost vanishes." and the faint-voice page follow. The ContinueDialog task cannot run inside a step, so the step continues the pages itself.
    if (!(await Execution.delayUntil(() => ChatDialog.canContinue() || Inventory.countById(SKULL_ID) === 0, 8000))) {
        return false;
    }
    await driveDialog([], log, 3000);
    return Execution.delayUntil(() => Inventory.countById(SKULL_ID) === 0, 8000);
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: AERECK }; }
    if (heldId(snap, SKULL_ID) > 0) { return { kind: 'custom', name: 'return skull', run: returnSkull }; }
    const amuletLower = AMULET.toLowerCase();
    if (!snap.inv.has(amuletLower) && !snap.worn.has(amuletLower)) {
        if (!snap.bankKnown) return { kind: 'scanBank', bank: DRAYNOR_BANK };
        if (bankedId(snap, AMULET_ID) > 0) {
            return { kind: 'withdraw', items: [{ name: AMULET, id: AMULET_ID, qty: 1 }], bank: DRAYNOR_BANK };
        }
        return { kind: 'talk', stop: URHNEY };
    }
    if (!snap.worn.has(amuletLower)) {
        return { kind: 'equip', item: AMULET };
    }
    return { kind: 'custom', name: 'ghost + skull', run: ghostAndSkull };
}

export const restlessghost: QuestModule = {
    record: QUESTS.find(r => r.id === 'priest')!,
    bank: DRAYNOR_BANK,
    tools: ['ghostspeak amulet', 'skull'],
    hops: WIZARD_HOPS,
    decide
};
