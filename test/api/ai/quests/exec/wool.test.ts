import { describe, expect, test } from 'bun:test';

import Tile from '#/bot/geometry/Tile.js';
import { gatherWool, isShearableSheep, type WoolSites } from '#/bot/api/ai/quests/exec/wool.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import { gatherBalls } from '#/bot/api/ai/quests/defs/sheepshearer.js';

// 377 content: wheel M:m50_50.jm2:9464; shears M:m49_51.jm2:7424.
const SITES: WoolSites = {
    pen: new Tile(3197, 3266, 0),
    wheelStand: new Tile(3209, 3213, 1),
    shearsSpawn: new Tile(3192, 3272, 0),
    spinLabel: 'spin wool at Lumbridge'
};

const snap = (items: [string, number][] = []): QuestSnapshot => ({
    journal: 'inProgress',
    inv: new Map(items),
    invIds: new Map(),
    worn: new Set(),
    wornIds: new Set(),
    noProgress: 0,
    bankCoins: 0
});

describe('gatherWool', () => {
    test('377 shearing accepts the three handler IDs and excludes The Thing', () => {
        // 377 content: shear_sheep.rs2:5-24, :26-44, :46-64, and :80-96.
        expect(isShearableSheep(43)).toBe(true);
        expect(isShearableSheep(1763)).toBe(true);
        expect(isShearableSheep(1765)).toBe(true);
        expect(isShearableSheep(3579)).toBe(false);
    });

    test('no shears -> grab the shears spawn, not the pen', () => {
        const step = gatherWool(snap(), 3, SITES);
        expect(step.kind === 'grabGround' && step.item).toBe('Shears');
        expect(step.kind === 'grabGround' && step.anchor.x).toBe(3192);
        expect(step.kind === 'grabGround' && step.anchor.z).toBe(3272);
    });

    test('shears but not enough wool -> shear', () => {
        const step = gatherWool(snap([['shears', 1]]), 3, SITES);
        expect(step.kind === 'custom' && step.name).toContain('shear');
    });

    test('enough wool -> spin, under the caller-supplied label', () => {
        const step = gatherWool(snap([['shears', 1], ['wool', 3]]), 3, SITES);
        expect(step.kind === 'custom' && step.name).toBe('spin wool at Lumbridge');
    });
});

describe('sheepshearer keeps its own sites and its own labels', () => {
    test('gatherBalls uses the 377 Lumbridge spinning-wheel label', () => {
        expect(gatherBalls(snap(), 20).kind).toBe('grabGround');
        expect(gatherBalls(snap([['shears', 1]]), 20).kind).toBe('custom');
        const spin = gatherBalls(snap([['shears', 1], ['wool', 20]]), 20);
        expect(spin.kind === 'custom' && spin.name).toBe('spin wool at Lumbridge');
    });

    test('its shears spawn is the nearby 377 table at 3192,3272 (m49_51.jm2:7424)', () => {
        const step = gatherBalls(snap(), 20);
        expect(step.kind === 'grabGround' && step.anchor.x).toBe(3192);
        expect(step.kind === 'grabGround' && step.anchor.z).toBe(3272);
    });
});
