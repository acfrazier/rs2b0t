import { expect, test, describe } from 'bun:test';
import { decide, gatherOnion, gatherRatsTail, gatherEyeOfNewt, gatherBurntMeat, hetty, parseHettyJournal, HETTY_STAGE } from '#/bot/api/ai/quests/defs/hetty.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const snap = (journal: string, items: [string, number][] = [], bankCoins = 0, stage?: number): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items),
    worn: new Set(),
    noProgress: 0,
    bankCoins,
    stage
});

const TAIL = "rat's tail";
const ALL_FOUR: [string, number][] = [[TAIL, 1], ['onion', 1], ['eye of newt', 1], ['burnt meat', 1]];

describe('hetty decide — quest states', () => {
    test('complete -> done, unknown -> wait', () => {
        expect(decide(snap('complete')).kind).toBe('done');
        expect(decide(snap('unknown')).kind).toBe('wait');
    });

    test('notStarted talks to Hetty with the start dialogue options', () => {
        const s = decide(snap('notStarted'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Hetty');
        expect(s.kind === 'talk' && s.stop.prefer).toEqual(['I am in search of a quest.', 'Yes help me become one with my darker side.']);
        // 377 maps/m46_50.jm2:8521: Hetty spawns at (2968,3206,0).
        expect(s.kind === 'talk' && [s.stop.anchor.x, s.stop.anchor.z]).toEqual([2968, 3206]);
    });

    test('holding all four ingredients hands in and drinks (one custom step)', () => {
        const s = decide(snap('inProgress', ALL_FOUR, 0, HETTY_STAGE.STARTED));
        expect(s.kind).toBe('custom');
        expect(s.kind === 'custom' && s.name).toMatch(/drink/i);
    });
    test('stage 2 (ingredients handed in) goes straight to the cauldron', () => {
        // 377 hetty.rs2:20-23 deletes the four ingredients at the hand-in; the journal (hetty_journal.rs2:40-42) is the stage oracle.
        const s = decide(snap('inProgress', [], 0, HETTY_STAGE.OBJECTS_GIVEN));
        expect(s.kind).toBe('custom');
        expect(s.kind === 'custom' && s.name).toMatch(/cauldron/);
    });
    test('inProgress without a journal stage waits for the stage oracle', () => {
        const s = decide(snap('inProgress'));
        expect(s.kind === 'wait' && s.reason).toMatch(/stage/);
    });
});

describe('hetty decide — gather routing (record-item order, self-heal any gap)', () => {
    test('nothing held -> the quest-gated rat tail first', () => {
        const s = decide(snap('inProgress', [], 0, HETTY_STAGE.STARTED));
        expect(s.kind === 'custom' && s.name).toMatch(/rat/i);
    });
    test('tail held -> onion next', () => {
        const s = decide(snap('inProgress', [[TAIL, 1]], 0, HETTY_STAGE.STARTED));
        expect(s.kind === 'pickLoc' && s.item).toBe('Onion');
    });
    test('tail+onion held, funded -> buy the eye of newt from Betty', () => {
        const s = decide(snap('inProgress', [[TAIL, 1], ['onion', 1]], 50, HETTY_STAGE.STARTED));
        expect(s.kind === 'buy' && s.shop.npc).toBe('Betty');
        expect(s.kind === 'buy' && s.item).toBe('Eye of newt');
    });
    test('tail+onion+eye held, funded -> burnt meat buys one raw beef from Wydin', () => {
        // 377 _unpack/727/all.inv:1186 stocks a single raw_beef, so the module buys qty 1.
        const s = decide(snap('inProgress', [[TAIL, 1], ['onion', 1], ['eye of newt', 1]], 50, HETTY_STAGE.STARTED));
        expect(s.kind === 'buy' && s.shop.npc).toBe('Wydin');
        expect(s.kind === 'buy' && s.item).toBe('Raw beef');
        expect(s.kind === 'buy' && s.qty).toBe(1);
    });
});

describe('hetty journal — 377 stage oracle (hetty_journal.rs2)', () => {
    test('stage texts map to server stages 0 -> 1 -> 2 -> 3', () => {
        expect(parseHettyJournal('I can start this quest by talking to Hetty in her house in Rimmington.')).toBe(HETTY_STAGE.NOT_STARTED);
        expect(parseHettyJournal('Hetty needs me to bring her the following: An onion')).toBe(HETTY_STAGE.STARTED);
        expect(parseHettyJournal('I should drink from the cauldron and improve my magic!')).toBe(HETTY_STAGE.OBJECTS_GIVEN);
        expect(parseHettyJournal('I drank from the cauldron and my magic power increased! QUEST COMPLETE!')).toBe(HETTY_STAGE.COMPLETE);
    });
    test('unrecognised text yields undefined (caller waits)', () => {
        expect(parseHettyJournal('something entirely different')).toBeUndefined();
    });
});

describe('hetty decide — rev 377 display name (all.obj [rats_tail])', () => {
    test("holding Rat's tail is enough to leave the kill and to hand in", () => {
        expect(decide(snap('inProgress', [[TAIL, 1]], 0, HETTY_STAGE.STARTED)).kind).toBe('pickLoc');
        const s = decide(snap('inProgress', ALL_FOUR, 0, HETTY_STAGE.STARTED));
        expect(s.kind === 'custom' && s.name).toMatch(/drink/i);
    });

    test("the pre-289 'rats tail' spelling is not the packed item", () => {
        const s = decide(snap('inProgress', [['rats tail', 1]], 0, HETTY_STAGE.STARTED));
        expect(s.kind === 'custom' && s.name).toMatch(/rat/i);
        const fakeFour = decide(snap('inProgress', [
            ['rats tail', 1], ['onion', 1], ['eye of newt', 1], ['burnt meat', 1]
        ], 0, HETTY_STAGE.STARTED));
        expect(fakeFour.kind === 'custom' && fakeFour.name).toMatch(/rat/i);
    });
});

describe('hetty gathers — startedOr gate + shape', () => {
    test('every gather starts the quest first when notStarted (the rat tail is quest-gated)', () => {
        for (const g of [gatherOnion, gatherRatsTail, gatherEyeOfNewt, gatherBurntMeat]) {
            const s = g(snap('notStarted'));
            expect(s.kind === 'talk' && s.stop.npc).toBe('Hetty');
        }
    });
    test('onion picks from the field; rat tail is a custom kill', () => {
        expect(gatherOnion(snap('inProgress')).kind).toBe('pickLoc');
        expect(gatherRatsTail(snap('inProgress')).kind).toBe('custom');
    });
    test('eye of newt: buy when funded, park when broke', () => {
        expect(gatherEyeOfNewt(snap('inProgress', [], 50)).kind).toBe('buy');
        const broke = gatherEyeOfNewt(snap('inProgress'));
        expect(broke.kind === 'wait' && broke.reason).toMatch(/gp for Eye of newt/);
    });
    test('burnt meat: raw meat first (buy), then the burn custom once meat is held', () => {
        expect(gatherBurntMeat(snap('inProgress', [], 50)).kind).toBe('buy');
        expect(gatherBurntMeat(snap('inProgress', [['raw beef', 2]])).kind).toBe('custom');
        expect(gatherBurntMeat(snap('inProgress', [['cooked meat', 1]])).kind).toBe('custom');
        const broke = gatherBurntMeat(snap('inProgress'));
        expect(broke.kind === 'wait' && broke.reason).toMatch(/gp for Raw beef/);
    });
});

describe('hetty module wiring', () => {
    test('binds the existing record, banks at Draynor, grinds the Rat, gathers all four', () => {
        expect(hetty.record.id).toBe('hetty');
        expect(hetty.record.name).toBe("Witch's Potion");
        expect(hetty.record.items.some(i => i.name === "Rat's tail")).toBe(true);
        expect(hetty.grind).toContain('Rat');
        expect(Object.keys(hetty.gather ?? {}).sort()).toEqual(['burnt meat', 'eye of newt', 'onion', TAIL]);
    });
});
