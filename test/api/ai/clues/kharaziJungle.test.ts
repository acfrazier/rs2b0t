import { afterEach, describe, expect, test } from 'bun:test';

import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import type { NavPoint } from '#/bot/event/webwalk/PathFinder.js';
import Tile from '#/bot/geometry/Tile.js';
import { CLUE_DB } from '#/bot/api/ai/clues/data/cluedb.js';
import { crossesKharazi, hasJungleMap, inKharazi, jungleCrossing, jungleAxe, jungleKitMissing } from '#/bot/api/ai/clues/kharaziTravel.js';
import { stubProps } from '../../../lib/stubSingletons.js';

const JUNGLE_INTERIOR: NavPoint = { x: 2950, z: 2902, level: 0 };
/** Two chops south of the mouth: the first jungle tile the band opens onto. */
const JUNGLE_LANDING: NavPoint = { x: 2816, z: 2936, level: 0 };
const KARAMJA_MAINLAND: NavPoint = { x: 2946, z: 3050, level: 0 };

describe('the 377 Kharazi clue inventory', () => {
    test('has no clue dig destinations inside the jungle', () => {
        const inside = Object.entries(CLUE_DB)
            .filter(([, clue]) => inKharazi(clue.coord ?? null))
            .map(([id]) => Number(id))
            .sort((a, b) => a - b);
        expect(inside).toEqual([]);
    });
});

let restore: (() => void)[] = [];

afterEach(() => {
    for (const undo of restore.reverse()) {
        undo();
    }
    restore = [];
});

function stubPack(opts: { at: NavPoint; inv?: string[]; worn?: string[]; bank?: string[]; legends?: string }): void {
    const inv = new Set((opts.inv ?? []).map(n => n.toLowerCase()));
    const worn = new Set((opts.worn ?? []).map(n => n.toLowerCase()));
    const bank = new Set((opts.bank ?? []).map(n => n.toLowerCase()));
    restore.push(
        stubProps(Game, { tile: () => new Tile(opts.at.x, opts.at.z, opts.at.level) }),
        stubProps(Inventory, {
            first: (name: string) => (inv.has(name.toLowerCase()) ? ({ id: 0, count: 1 } as never) : null)
        }),
        stubProps(Equipment, { contains: (name: string) => worn.has(name.toLowerCase()) }),
        stubProps(Bank, { count: (name: string) => (bank.has(name.toLowerCase()) ? 1 : 0) }),
        stubProps(Skills, { level: () => 60 }),
        stubProps(Quests, { status: () => (opts.legends ?? 'started') as never })
    );
}

describe('cutting into the jungle', () => {
    test('the direction to cut follows which end is inside', () => {
        expect(inKharazi(JUNGLE_INTERIOR)).toBe(true);
        expect(inKharazi(KARAMJA_MAINLAND)).toBe(false);
        expect(jungleCrossing(JUNGLE_INTERIOR, KARAMJA_MAINLAND)).toBe('enter');
        expect(jungleCrossing(KARAMJA_MAINLAND, JUNGLE_INTERIOR)).toBe('leave');
        expect(jungleCrossing(JUNGLE_INTERIOR, JUNGLE_LANDING)).toBe('none');
        expect(jungleCrossing(KARAMJA_MAINLAND, KARAMJA_MAINLAND)).toBe('none');
        // Why: an unknown tile reads as outside, so a walk to a jungle destination still cuts in rather than giving up.
        expect(jungleCrossing(JUNGLE_INTERIOR, null)).toBe('enter');
    });

    test('a jungle destination crosses from the mainland and not from inside', () => {
        stubPack({ at: KARAMJA_MAINLAND });
        expect(crossesKharazi(JUNGLE_INTERIOR)).toBe(true);
        restore.pop()!();

        stubPack({ at: JUNGLE_LANDING });
        expect(crossesKharazi(JUNGLE_INTERIOR)).toBe(false);
        expect(crossesKharazi(KARAMJA_MAINLAND)).toBe(true);
    });

    test('the kit the server checks is reported item by item when the pack is empty', () => {
        stubPack({ at: KARAMJA_MAINLAND });
        expect(jungleKitMissing()).toEqual(['Machete', 'an axe', 'Radimus notes (Legends Quest reads started)']);
    });

    test('a machete, any axe and the notes are enough', () => {
        stubPack({ at: KARAMJA_MAINLAND, inv: ['Machete', 'Bronze axe', 'Radimus notes'] });
        expect(jungleKitMissing()).toEqual([]);
    });

    test('a finished Legends account needs no notes, and a worn machete counts', () => {
        stubPack({ at: KARAMJA_MAINLAND, inv: ['Iron axe'], worn: ['Machete'], legends: 'complete' });
        expect(hasJungleMap()).toBe(true);
        expect(jungleKitMissing()).toEqual([]);
    });

    test('the bank supplies the best axe it has, not the first', () => {
        stubPack({ at: KARAMJA_MAINLAND, bank: ['Bronze axe', 'Mithril axe', 'Adamant axe'] });
        expect(jungleAxe()).toBe('Adamant axe');
    });

    test('no axe anywhere reads as none', () => {
        stubPack({ at: KARAMJA_MAINLAND });
        expect(jungleAxe()).toBeNull();
    });
});
