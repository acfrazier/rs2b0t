import { describe, expect, test } from 'bun:test';
import { BANK_LOCATIONS } from '#/bot/api/bank/BankLocations.js';
import Tile from '#/bot/geometry/Tile.js';
import { WOODCUTTING_LOCATIONS, WOODCUTTING_LOCATION_OPTIONS, resolveWoodcuttingLocation, ENT_NPC_IDS, ENT_LIFE_TICKS, isEntNpcId, entNpcOnTile } from '#/bot/data/woodcuttingLocations.js';

const bankTiles = new Set(BANK_LOCATIONS.map(b => `${b.tile.x},${b.tile.z},${b.tile.level}`));

describe('resolveWoodcuttingLocation', () => {
    test('Use Start Position and Use Custom Position are freeform (null)', () => {
        expect(resolveWoodcuttingLocation('Use Start Position', new Tile(3087, 3234, 0))).toBeNull();
        expect(resolveWoodcuttingLocation('Use Custom Position', new Tile(3087, 3234, 0))).toBeNull();
    });

    test('Use Closest near Draynor willows', () => {
        expect(resolveWoodcuttingLocation('Use Closest', new Tile(3087, 3234, 0))?.name).toBe('Draynor Willows');
    });

    test('Use Closest near Seers maples', () => {
        // 377: the maple stand moved into the grove at 2722,3572, so the probe stands there.
        expect(resolveWoodcuttingLocation('Use Closest', new Tile(2722, 3572, 0))?.name).toBe('Seers Maples');
    });

    test('Use Closest still snaps even NW of Crafting Guild (no chunk gate)', () => {
        // 2910,3328, not same 64x64 as Crafting Guild mine or any WC preset, now nearest not freeform.
        expect(resolveWoodcuttingLocation('Use Closest', new Tile(2910, 3328, 0))).not.toBeNull();
    });

    test('named match is case-insensitive', () => {
        expect(resolveWoodcuttingLocation('edgeville yews', new Tile(0, 0, 0))?.name).toBe('Edgeville Yews');
    });
});

describe('WOODCUTTING_LOCATIONS table', () => {
    test('dropdown is Auto + Use Closest + Use Start Position + Use Custom Position + legacy None + camps', () => {
        expect(WOODCUTTING_LOCATION_OPTIONS).toEqual(['Auto', 'Use Closest', 'Use Start Position', 'Use Custom Position', 'None', ...WOODCUTTING_LOCATIONS.map(l => l.name)]);
    });

    test('every bankStand is a known BANK_LOCATIONS tile', () => {
        for (const loc of WOODCUTTING_LOCATIONS) {
            const key = `${loc.bankStand.x},${loc.bankStand.z},${loc.bankStand.level}`;
            expect(bankTiles.has(key), `${loc.name} bank ${key}`).toBe(true);
        }
    });

    test('core catalog entries are verified; tick-manip camps may be provisional', () => {
        const provisional = new Set(['S Falador Oaks', 'Lumbridge Farmer Willows', 'Lumbridge Castle Willows']);
        for (const loc of WOODCUTTING_LOCATIONS) {
            if (provisional.has(loc.name)) {
                expect(loc.verified, loc.name).toBe(false);
            } else {
                expect(loc.verified, loc.name).toBe(true);
            }
        }
    });

    test('includes tick-manip WC camps (#160)', () => {
        const names = new Set(WOODCUTTING_LOCATIONS.map(l => l.name));
        expect(names.has('S Falador Oaks')).toBe(true);
        expect(names.has('Lumbridge Farmer Willows')).toBe(true);
        expect(names.has('Lumbridge Castle Willows')).toBe(true);
    });

    test('fire spots are not mixed into chop camps', () => {
        // Burn strips live in FiremakingLogic, chop table is trees + bank only.
        for (const loc of WOODCUTTING_LOCATIONS) {
            expect('rangeStand' in loc).toBe(false);
            expect(loc.spot).toBeDefined();
            expect(loc.bankStand).toBeDefined();
        }
    });
});

describe('ENT_NPC_IDS', () => {
    // 377: the pack numbers macro_ent_* 1719-1750 and 1791-1792 (`pack/npc.pack:1720-1751,1792-1793`); the 289 ids 444-452 are gone,
    // and the neighbours are not ents (crow 1751, favour_jimmy 1718, mm_waymottin_final_battle 1790, favour_tassie_slipcast 1793).
    test('covers the 377 macro_ent pack rows and stops at their neighbours', () => {
        expect(ENT_LIFE_TICKS).toBe(60);
        expect(ENT_NPC_IDS.size).toBe(34);
        expect(isEntNpcId(1718)).toBe(false);
        expect(isEntNpcId(1719)).toBe(true);
        expect(isEntNpcId(1750)).toBe(true);
        expect(isEntNpcId(1751)).toBe(false);
        expect(isEntNpcId(1790)).toBe(false);
        expect(isEntNpcId(1791)).toBe(true);
        expect(isEntNpcId(1792)).toBe(true);
        expect(isEntNpcId(1793)).toBe(false);
    });

    test('entNpcOnTile is the clicked loc only', () => {
        const tree = { x: 3087, z: 3234, level: 0 };
        const neighbour = { x: 3088, z: 3234, level: 0 };
        const npcs = [{ id: 1736, tile: tree }];
        expect(entNpcOnTile(npcs, tree)).toBe(true);
        expect(entNpcOnTile(npcs, neighbour)).toBe(false);
        expect(entNpcOnTile([{ id: 1718, tile: tree }], tree)).toBe(false);
    });
});
