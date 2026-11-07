import { describe, expect, test } from 'bun:test';

import { CLUE_DB } from '#/bot/api/ai/clues/data/cluedb.js';
import { CLUE_GATES } from '#/bot/api/ai/clues/data/clueGates.js';
import { PUZZLE_PIECE_SLOT } from '#/bot/api/ai/clues/data/puzzlePieces.js';
import { QUESTS } from '#/bot/api/ai/quests/data/quests.js';
import { PUZZLE_BLANK_SLOT } from '#/bot/api/ai/clues/puzzleLogic.js';

const rows = Object.values(CLUE_DB);
const hard = rows.filter(row => row.obj.includes('_hard_'));

describe('hard tier in CLUE_DB', () => {
    // 377: the trail_hard.enum carries 31 rows (`minigames/game_trail/configs/trail_hard.enum`, 31 `val=`
    // lines) and the generated cluedb covers all of them plus the easy/medium tiers: 101 rows.
    test('all 31 hard clues from trail_hard.enum are present', () => {
        expect(hard.length).toBe(31);
        expect(rows.length).toBe(101);
    });

    test('the tiers share one table without colliding on an obj id', () => {
        expect(new Set(rows.map(r => r.id)).size).toBe(rows.length);
    });

    // A trail_casket param alone does not make a dig: riddle004 carries one but
    // has no coord and is answered by talking to Gerrant.
    test('every dig has a coord and every talk has an npc', () => {
        expect(rows.filter(r => r.type === 'dig' && !r.coord)).toEqual([]);
        expect(rows.filter(r => r.type === 'talk' && !r.npc)).toEqual([]);
        expect(CLUE_DB[2778]).toMatchObject({ type: 'talk', npc: 'Gerrant' });
    });
});

describe('dig guardians', () => {
    const guarded = hard.filter(row => row.guardian !== undefined);

    // 377: the 13 guarded sextant digs all name the Zamorak Wizard (the staged cluedb guardian fields,
    // generated from the 377 trail content); the Saradomin Wizard no longer guards any 377 dig.
    test('13 coordinate digs are guarded, all by the Zamorak Wizard', () => {
        expect(guarded.length).toBe(13);
        expect([...new Set(guarded.map(r => r.guardian))].sort()).toEqual(['Zamorak Wizard']);
    });

    test('a guardian only ever sits on a sextant dig', () => {
        expect(guarded.filter(r => r.type !== 'dig')).toEqual([]);
        expect(guarded.filter(r => r.needsSextant !== true)).toEqual([]);
    });

    test('no easy or medium clue picked up a guardian', () => {
        expect(rows.filter(r => r.guardian !== undefined && !r.obj.includes('_hard_'))).toEqual([]);
    });
});

describe('puzzle boxes', () => {
    const puzzles = hard.filter(row => row.puzzle !== undefined);

    // 377: three hard talk clues hand over a puzzle box (cluedb rows 2794/2797/2799, the riddle014/016/017
    // puzzleboxes); the 289 trail had nine.
    test('3 talk clues hand over a puzzle box, each with a resolved obj id', () => {
        expect(puzzles.length).toBe(3);
        expect(puzzles.filter(r => r.type !== 'talk')).toEqual([]);
        expect(puzzles.filter(r => !Number.isInteger(r.puzzle!.id) || r.puzzle!.id <= 0)).toEqual([]);
    });

    test('the three piece sets cover every board slot exactly once', () => {
        const slots = Object.values(PUZZLE_PIECE_SLOT);
        expect(slots.length).toBe(72);
        for (let set = 0; set < 3; set++) {
            const ofSet = slots.slice(set * 24, set * 24 + 24).sort((a, b) => a - b);
            expect(ofSet).toEqual(Array.from({ length: PUZZLE_BLANK_SLOT }, (_, i) => i));
        }
    });
});

describe('gated clues', () => {
    // 377: the table is empty (clueGates.ts; the 289 Isafdar/Regicide rows have no 377 clue items), so the
    // two loop guards below hold vacuously until a 377 clue gains a quest gate; this pins the state itself.
    test('no 377 clue is quest-gated', () => {
        expect(Object.keys(CLUE_GATES)).toEqual([]);
    });

    test('every gate names a real clue and gives a reason', () => {
        for (const [idStr, gate] of Object.entries(CLUE_GATES)) {
            expect(CLUE_DB[Number(idStr)], `gate ${idStr} is not a clue`).toBeDefined();
            expect(gate.reason.length).toBeGreaterThan(10);
        }
    });

    test('every gate names a quest the bot can drive', () => {
        const known = new Set(QUESTS.map(q => q.name));
        for (const [idStr, gate] of Object.entries(CLUE_GATES)) {
            expect(known.has(gate.quest), `gate ${idStr} names '${gate.quest}'`).toBe(true);
        }
    });
});
