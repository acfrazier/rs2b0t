import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { skipUnless } from '../lib/skipUnless.js';
import { GAS_ROCK_IDS, ROCK_OPTIONS, ROCK_TYPES, ROCK_TIER_ORDER, rockTierById, resolveRockIds } from '#/bot/data/miningRocks.js';
import { PICKAXES, bestPickaxe } from '#/bot/api/acquisition/Tools.js';

const CONTENT = process.env.CONTENT_DIR ?? '';

/** The 377 content checkout this slice qualifies against; a 289 CONTENT_DIR is an input error, not a skip. */
const is377Content = existsSync(join(CONTENT, 'pack', 'loc.pack')) && existsSync(join(CONTENT, 'scripts', '_unpack', '377'));

/** debugname -> loc id, from the content's own pack file (e.g. `9709:9708=rocks_9708`). */
function locPackNames(): Map<string, number> {
    const names = new Map<string, number>();
    for (const line of readFileSync(join(CONTENT, 'pack', 'loc.pack'), 'ascii').split('\n')) {
        const eq = line.indexOf('=');
        const colon = line.indexOf(':');
        if (eq !== -1 && colon !== -1) {
            names.set(line.slice(eq + 1).trim(), Number(line.slice(colon + 1, eq)));
        }
    }
    return names;
}

/** Rock loc ids the 377 maps place, parsed from the text `==== LOC ====` sections. */
function placedRockIds(): Set<number> {
    const placed = new Set<number>();
    const maps = join(CONTENT, 'maps');
    for (const file of readdirSync(maps)) {
        if (!file.endsWith('.jm2')) continue;
        let inLoc = false;
        for (const line of readFileSync(join(maps, file), 'ascii').split('\n')) {
            if (line.startsWith('====')) {
                inLoc = line.startsWith('==== LOC');
                continue;
            }
            if (!inLoc) continue;
            const m = /^\d \d+ \d+: (\d+) \d+ \d+$/.exec(line.trim());
            if (m) placed.add(Number(m[1]));
        }
    }
    return placed;
}

test('every ore keeps at least one rock and the ladder order is unchanged', () => {
    for (const [name, ids] of Object.entries(ROCK_TYPES)) {
        expect(ids.length > 0, name).toBe(true);
    }
    expect(ROCK_TIER_ORDER).toEqual([
        'Clay',
        'Copper',
        'Tin',
        'Iron',
        'Silver',
        'Coal',
        'Gold',
        'Mithril',
        'Adamantite',
        'Runite'
    ]);
});

test('all rock loc ids are unique across ore types', () => {
    const all = Object.values(ROCK_TYPES).flat();
    expect(new Set(all).size).toBe(all.length);
});

test('ROCK_OPTIONS lists every ore type', () => {
    expect(ROCK_OPTIONS).toEqual(Object.keys(ROCK_TYPES));
});

test('resolveRockIds maps selected names to their ids (case-insensitive)', () => {
    const iron = resolveRockIds(['iron']);
    const coal = resolveRockIds(['COAL']);
    expect(iron.size).toBeGreaterThan(0);
    expect(coal.size).toBeGreaterThan(0);
    // 377 migration pin: the selector must reach the new-series rocks, not only the 289 classic block;
    // iron 9717 and coal 11930 come from the 377 tables (mine.dbrow:68-70 and :84-86 via loc.pack).
    expect([...iron]).toContain(9717);
    expect([...coal]).toContain(11930);
});

test('resolveRockIds ignores unknown names and empty input', () => {
    expect(resolveRockIds(['granite', '']).size).toBe(0);
    expect(resolveRockIds([]).size).toBe(0);
});

describe.skipIf(skipUnless('content'))('377 pack-backed rocks (content-gated)', () => {
    test('the CONTENT_DIR is the 377 content, not another revision', () => {
        expect(is377Content, 'CONTENT_DIR must point at the 377 content (scripts/_unpack/377 and pack/loc.pack expected)').toBe(true);
    });

    test('every rock id is a Mine-op "Rocks" loc in the 377 pack, and every ore keeps a placed field', () => {
        const names = locPackNames();
        const idByName = new Map([...names].map(([name, id]) => [id, name]));
        const placed = placedRockIds();
        for (const [name, ids] of Object.entries(ROCK_TYPES)) {
            for (const id of ids) {
                const debugname = idByName.get(id);
                expect(debugname, `${name} id ${id} is not in the 377 loc.pack`).toBeDefined();
                // All ore rocks render as "Rocks" (all.loc `[rocks_9708] name=Rocks`, `[copperrock1] name=Rocks`).
                expect(debugname, `id ${id} (${debugname}) is not a Rocks loc`).toMatch(/^(rocks(_\d+)?|[a-z]*rock\d*)$/);
                expect(placed.has(id), `377 maps never place ${name} rock ${id} (${debugname})`).toBe(true);
            }
        }
    });

    test('the Rimmington field the Doric quest mines is inside the resolved ore sets', () => {
        // The 377 Rimmington placements are the new-series rocks: clay 9713 @ (2986,3239), copper 9710 @ (2976,3247),
        // iron 9717 @ (2982,3234) (maps/m46_50.jm2 and m46_51.jm2; RS2B0T-377-S9-1106/placements-rocks.txt).
        const ids = resolveRockIds(['clay', 'copper', 'iron']);
        for (const id of [9713, 9710, 9717]) {
            expect([...ids], `rock ${id} missing from the selector`).toContain(id);
        }
    });
});

describe('bestPickaxe', () => {
    const bank = (names: string[]) => (name: string) => names.includes(name);

    test('41 mining takes the rune pickaxe when the bank has one', () => {
        expect(bestPickaxe(41, bank(['Rune pickaxe', 'Adamant pickaxe', 'Bronze pickaxe']))).toBe('Rune pickaxe');
    });

    test('41 mining without a rune pick falls to adamant, then mithril, etc.', () => {
        expect(bestPickaxe(41, bank(['Adamant pickaxe', 'Mithril pickaxe']))).toBe('Adamant pickaxe');
        expect(bestPickaxe(41, bank(['Mithril pickaxe', 'Bronze pickaxe']))).toBe('Mithril pickaxe');
        expect(bestPickaxe(41, bank(['Bronze pickaxe']))).toBe('Bronze pickaxe');
    });

    test('level gates: 40 mining skips rune even when banked', () => {
        expect(bestPickaxe(40, bank(['Rune pickaxe', 'Adamant pickaxe']))).toBe('Adamant pickaxe');
        expect(bestPickaxe(20, bank(['Rune pickaxe', 'Adamant pickaxe', 'Mithril pickaxe', 'Steel pickaxe']))).toBe('Steel pickaxe');
        expect(bestPickaxe(5, bank(['Steel pickaxe', 'Iron pickaxe']))).toBe('Iron pickaxe');
    });

    test('empty bank → null', () => {
        expect(bestPickaxe(99, bank([]))).toBe(null);
    });

    test('tiers are best-first and level-descending', () => {
        for (let i = 1; i < PICKAXES.length; i++) {
            expect(PICKAXES[i - 1].level).toBeGreaterThanOrEqual(PICKAXES[i].level);
        }
    });
});

describe('GAS_ROCK_IDS', () => {
    test('gas variants never overlap the real ore rock ids', () => {
        for (const ids of Object.values(ROCK_TYPES)) {
            for (const id of ids) {
                expect(GAS_ROCK_IDS.has(id)).toBe(false);
            }
        }
    });

    test('the gemrock gas form is guarded (it is a listed 377 gem-table rock)', () => {
        // mine.dbrow:180-187 `[gem_rock]` lists gemrock and macro_gemrock; the 377 maps place gemrocks at Shilo.
        expect(GAS_ROCK_IDS.has(2140)).toBe(true);
    });
});

describe('rockTierById', () => {
    test('ranks runite above coal above iron', () => {
        expect(rockTierById(2106)).toBeGreaterThan(rockTierById(2096));
        expect(rockTierById(2096)).toBeGreaterThan(rockTierById(2092));
        expect(rockTierById(2106)).toBe(9);
    });

    test('every id of one ore shares its tier, classic and 377 series alike', () => {
        for (const ids of Object.values(ROCK_TYPES)) {
            const tier = rockTierById(ids[0]!);
            for (const id of ids) {
                expect(rockTierById(id), `id ${id}`).toBe(tier);
            }
        }
    });

    test('local ids outside ROCK_TYPES have no tier', () => {
        expect(rockTierById(450)).toBe(-1);
        // the 377 depleted rock forms are not targets either
        expect(rockTierById(9723)).toBe(-1);
    });
});
