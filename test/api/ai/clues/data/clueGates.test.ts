import { describe, expect, test } from 'bun:test';

import { CLUE_GATES, clueGate } from '#/bot/api/ai/clues/data/clueGates.js';
import type { QuestStatus } from '#/bot/api/ui/questlog/Quests.js';

const always = (status: QuestStatus) => (): QuestStatus => status;

// 377: the generated cluedb (tools/clues/gen-cluedb.ts against content a15d0faa8) carries 74 clue rows and none
// sits in Isafdar or the elf camp (the 289 rows 3560/3562/3564 are not placed), so CLUE_GATES stays empty.
describe('clueGate', () => {
    test('an ungated clue is open whatever the journal says', () => {
        expect(clueGate(2677, always('notStarted'))).toBeNull();
    });

    test('the 377 clue set has no quest-sealed destination', () => {
        expect(Object.keys(CLUE_GATES)).toEqual([]);
    });

    test('every gate asks about the quest it names', () => {
        const asked: string[] = [];
        for (const id of Object.keys(CLUE_GATES).map(Number)) {
            clueGate(id, name => {
                asked.push(name);
                return 'complete';
            });
        }
        expect(asked.length).toBe(Object.keys(CLUE_GATES).length);
        expect(asked).toEqual(Object.values(CLUE_GATES).map(g => g.quest));
    });
});
