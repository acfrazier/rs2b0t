import { describe, expect, test } from 'bun:test';
import {
    MELEE_WEAPONS,
    bankedWeapon,
    heldWeapon,
    wieldable,
    PICKAXES,
    bankedPickaxe
} from '#/bot/api/ai/quests/weapons.js';

const done = (): boolean => true;
const none = (): boolean => false;
const nameOf = (w: { name: string } | null): string | null => w?.name ?? null;

describe('the tier a level buys', () => {
    test('60 attack reaches dragon', () => {
        expect(wieldable(60, done)[0].tier).toBe('Dragon');
    });

    test('40 to 59 stops at rune', () => {
        for (const level of [40, 59]) {
            expect(wieldable(level, done)[0].tier).toBe('Rune');
        }
    });

    test('each band stops at its own tier', () => {
        expect(wieldable(39, done)[0].tier).toBe('Adamant');
        expect(wieldable(30, done)[0].tier).toBe('Adamant');
        expect(wieldable(29, done)[0].tier).toBe('Mithril');
        expect(wieldable(19, done)[0].tier).toBe('Black');
        expect(wieldable(9, done)[0].tier).toBe('Steel');
        expect(wieldable(4, done)[0].tier).toBe('Iron');
        expect(wieldable(1, done)[0].tier).toBe('Iron');
    });

    test('a tier offers every weapon type the item db knows, not one hard-coded pick', () => {
        const rune = MELEE_WEAPONS.filter(w => w.tier === 'Rune').map(w => w.name);
        expect(rune).toContain('Rune scimitar');
        expect(rune).toContain('Rune longsword');
        expect(rune).toContain('Rune battleaxe');
        expect(rune.length).toBeGreaterThan(3);
    });
});

describe('dragon melee is gated on a quest as well as the level', () => {
    test('60 attack without the quests falls back to rune', () => {
        expect(wieldable(60, none)[0].tier).toBe('Rune');
    });

    test("Lost City unlocks the longsword and dagger, Hero's Quest the mace and battleaxe", () => {
        const lostCity = wieldable(60, q => q === 'Lost City').filter(w => w.tier === 'Dragon').map(w => w.name);
        expect(lostCity).toEqual(['Dragon longsword', 'Dragon dagger']);

        const heroes = wieldable(60, q => q === "Hero's Quest").filter(w => w.tier === 'Dragon').map(w => w.name);
        expect(heroes).toEqual(['Dragon battleaxe', 'Dragon mace']);
    });

    test('Monkey Madness unlocks the dragon scimitar (tier60.rs2:14)', () => {
        const monkey = wieldable(60, q => q === 'Monkey Madness').filter(w => w.tier === 'Dragon').map(w => w.name);
        expect(monkey).toEqual(['Dragon scimitar']);
    });
});

describe('picking from what the account actually has', () => {
    const id = (name: string): number => MELEE_WEAPONS.find(w => w.name === name)!.id;

    test('the bank gives up its best wieldable weapon', () => {
        const bank = new Map([[id('Bronze scimitar'), 1], [id('Rune scimitar'), 1], [id('Dragon longsword'), 1]]);
        expect(nameOf(bankedWeapon(bank, 60, done))).toBe('Dragon longsword');
        expect(nameOf(bankedWeapon(bank, 40, done))).toBe('Rune scimitar');
        expect(nameOf(bankedWeapon(bank, 1, done))).toBe('Bronze scimitar');
    });

    test('a banked weapon the level cannot reach is skipped, not withdrawn', () => {
        const bank = new Map([[id('Dragon longsword'), 1], [id('Mithril scimitar'), 1]]);
        expect(nameOf(bankedWeapon(bank, 59, done))).toBe('Mithril scimitar');
    });

    test('a dragon weapon without its quest is skipped even at 60', () => {
        const bank = new Map([[id('Dragon longsword'), 1], [id('Rune scimitar'), 1]]);
        expect(nameOf(bankedWeapon(bank, 60, none))).toBe('Rune scimitar');
    });

    test('an empty bank yields nothing rather than a default', () => {
        expect(bankedWeapon(new Map(), 60, done)).toBeNull();
        expect(bankedWeapon(undefined, 60, done)).toBeNull();
    });

    test('a worn weapon counts as held', () => {
        expect(nameOf(heldWeapon(undefined, new Set([id('Rune scimitar')]), 60, done))).toBe('Rune scimitar');
        expect(nameOf(heldWeapon(new Map([[id('Rune scimitar'), 1]]), undefined, 60, done))).toBe('Rune scimitar');
    });
});

describe('pickaxes ride the same tiers', () => {
    const id = (name: string): number => PICKAXES.find(p => p.name === name)!.id;

    test('the attack level buys the pickaxe tier, the way it buys a scimitar', () => {
        expect(bankedPickaxe(new Map([[id('Rune pickaxe'), 1]]), 40)).toMatchObject({ name: 'Rune pickaxe' });
        expect(bankedPickaxe(new Map([[id('Rune pickaxe'), 1]]), 39)).toBeNull();
    });

    test('the best banked pickaxe wins over the cheapest', () => {
        const bank = new Map([[id('Bronze pickaxe'), 1], [id('Rune pickaxe'), 1], [id('Steel pickaxe'), 1]]);
        expect(bankedPickaxe(bank, 40)).toMatchObject({ name: 'Rune pickaxe' });
        expect(bankedPickaxe(bank, 30)).toMatchObject({ name: 'Steel pickaxe' });
        expect(bankedPickaxe(bank, 1)).toMatchObject({ name: 'Bronze pickaxe' });
    });

    test('an empty bank yields nothing rather than a bronze default', () => {
        expect(bankedPickaxe(new Map(), 40)).toBeNull();
    });

    test('a pickaxe is never offered as a weapon to fight with', () => {
        expect(MELEE_WEAPONS.some(w => w.name.includes('pickaxe'))).toBe(false);
    });
});
