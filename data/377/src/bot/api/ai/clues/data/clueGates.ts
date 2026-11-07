// Why: the solver reports the reason and abandons instead of walking until the navigator gives up.
// Why: the audit allowlists these instead of counting them as findings.
// Why: a clue belongs here only when a quest seals its destination; awkward walks don't count.
// Why: the journal is read at solve time, so an account that has finished the quest walks the clue instead of abandoning it.
// @see docs/reference/clues-gates.md#gated-clues

import type { QuestStatus } from '#/bot/api/ui/questlog/Quests.js';

export interface ClueGate {
    /** Quest-list display name, as `Quests.status` matches it. */
    quest: string;
    /** What the quest is holding shut. */
    reason: string;
}

/** Clues whose destination a quest seals off. */
// 377: the table is empty. The only 289 rows (3560/3562/3564, the Isafdar dig and elf-camp clues) have no
// 377 clue items at all: the 377 trail content (`_unpack/377/all.obj`, 367 `trail_clue*` objs) carries no
// isafdar clue, and the staged cluedb (2677-2858) has no such ids. A row for a clue the content does not
// sell would be a stale gate (the audit reports it), so the gate moves with the content (pitfall 16).
export const CLUE_GATES: Record<number, ClueGate> = {};

// Why: `unknown` is the quest tab not loaded yet, so only `complete` opens the gate.
export function clueGate(id: number, status: (quest: string) => QuestStatus): string | null {
    const gate = CLUE_GATES[id];
    if (gate === undefined) {
        return null;
    }
    const journal = status(gate.quest);
    return journal === 'complete' ? null : `${gate.reason} (${gate.quest} reads ${journal})`;
}
