import { expect, test, describe } from 'bun:test';
import { cooksassistant, decide, gatherFlour, gatherMilk } from '#/bot/api/ai/quests/defs/cooksassistant.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const snap = (journal: string, items: [string, number][] = []): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items),
    worn: new Set(),
    noProgress: 0,
    bankCoins: 0
});

describe('cooksassistant gathers', () => {
    test('flour: pot first, then grain from pickable wheat only, then the mill custom', () => {
        expect(gatherFlour(snap('inProgress'))).toMatchObject({ kind: 'grabGround', item: 'Pot' });
        expect(gatherFlour(snap('inProgress', [['pot', 1]]))).toMatchObject({ kind: 'custom', name: 'pick grain' });
        expect(gatherFlour(snap('inProgress', [['pot', 1], ['grain', 1]]))).toMatchObject({ kind: 'custom', name: 'mill flour' });
    });
    test('milk: bucket first, then use it on the Dairy Cow loc (377 cow_milking.rs2), not the Cow NPC', () => {
        expect(gatherMilk(snap('inProgress')).kind).toBe('grabGround');
        expect(gatherMilk(snap('inProgress', [['bucket', 1]]))).toMatchObject({ kind: 'useOn', targetKind: 'loc', target: 'Dairy Cow', product: 'Bucket of milk' });
    });
});

describe('cooksassistant decide', () => {
    test('notStarted and full-handed both talk to the Cook', () => {
        const s = decide(snap('notStarted'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Cook');
        const s2 = decide(snap('inProgress', [['egg', 1], ['bucket of milk', 1], ['pot of flour', 1]]));
        expect(s2.kind === 'talk' && s2.stop.npc).toBe('Cook');
    });
    test('inProgress missing an ingredient self-heals through the gathers', () => {
        const s = decide(snap('inProgress', [['egg', 1], ['bucket of milk', 1]]));
        expect(s.kind).not.toBe('talk');
    });
    test('the egg waits at the pen instead of treating arrival as a take', () => {
        const s = decide(snap('inProgress'));
        expect(s).toMatchObject({ kind: 'grabGround', item: 'Egg', waitIfMissing: true });
    });
});

describe('cooksassistant module', () => {
    test('spends nothing, so it carries no engine coin float', () => {
        expect(cooksassistant.coinFloat).toBe(0);
    });
});
