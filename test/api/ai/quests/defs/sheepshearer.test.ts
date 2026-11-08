import { expect, test, describe } from 'bun:test';
import { decide, gatherBalls, sheepshearer } from '#/bot/api/ai/quests/defs/sheepshearer.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const snap = (journal: string, items: [string, number][] = []): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items),
    worn: new Set(),
    noProgress: 0,
    bankCoins: 0
});

describe('sheepshearer gatherBalls', () => {
    test('no shears -> grab the free table spawn beside Fred (377 m49_51.jm2:7424)', () => {
        const step = gatherBalls(snap('inProgress'), 20);
        expect(step.kind).toBe('grabGround');
        expect(step.kind === 'grabGround' && step.anchor.x).toBe(3192);
        expect(step.kind === 'grabGround' && step.anchor.z).toBe(3272);
    });
    test('shears held, short of wool -> shear (custom)', () => {
        const s = gatherBalls(snap('inProgress', [['shears', 1], ['wool', 3]]), 20);
        expect(s.kind).toBe('custom');
    });
    test('enough wool -> spin at Lumbridge Castle (377 m50_50.jm2:9464)', () => {
        const s = gatherBalls(snap('inProgress', [['shears', 1], ['wool', 20]]), 20);
        expect(s.kind === 'custom' && s.name).toBe('spin wool at Lumbridge');
    });
});

describe('sheepshearer decide', () => {
    test('notStarted -> Fred; balls held -> Fred (hand-in); complete -> done', () => {
        const s = decide(snap('notStarted'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Fred the Farmer');
        const s2 = decide(snap('inProgress', [['ball of wool', 20]]));
        expect(s2.kind === 'talk' && s2.stop.npc).toBe('Fred the Farmer');
        expect(decide(snap('complete')).kind).toBe('done');
    });
    test('inProgress with no balls -> re-gather (partial hand-in / lost wool recovery)', () => {
        expect(decide(snap('inProgress')).kind).not.toBe('talk');
    });
});

describe('sheepshearer module', () => {
    test('spends nothing, so it carries no engine coin float', () => {
        expect(sheepshearer.coinFloat).toBe(0);
    });
});
