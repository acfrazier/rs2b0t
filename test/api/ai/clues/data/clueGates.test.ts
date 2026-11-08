import { describe, expect, test } from 'bun:test';

import { CLUE_GATES, clueGate } from '#/bot/api/ai/clues/data/clueGates.js';
import type { QuestStatus } from '#/bot/api/ui/questlog/Quests.js';

const always = (status: QuestStatus) => (): QuestStatus => status;

// 377 canon 1108 adds two Isafdar digs and Lord Iorwerth's elf-camp riddle; Regicide gates all three.
describe('clueGate', () => {
    const gatedIds = [3560, 3562, 3564] as const;

    test('an ungated clue is open whatever the journal says', () => {
        expect(clueGate(2677, always('notStarted'))).toBeNull();
    });

    for (const status of ['notStarted', 'inProgress', 'unknown'] as const) {
        test(`${status} Regicide keeps every gated clue closed`, () => {
            for (const id of gatedIds) {
                const reason = clueGate(id, always(status));
                expect(reason).not.toBeNull();
                expect(reason).toContain(`Regicide reads ${status}`);
            }
        });
    }

    test('complete Regicide opens every gated clue', () => {
        for (const id of gatedIds) expect(clueGate(id, always('complete'))).toBeNull();
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
