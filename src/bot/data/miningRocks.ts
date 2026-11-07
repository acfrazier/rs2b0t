/**
 * Ore loc ids from the 377 mine tables and the 377 `loc.pack`; all render as "Rocks", so ore and depleted states are distinguished by id.
 * Why: Dwarven iron spans two clusters, so `findRock` prefers the cluster nearest the player.
 *
 * 377 sources (content a15d0faa8):
 * - `scripts/skill_mining/configs/mine.dbrow` names every rock per ore table: clay :12-20, copper :30-36, tin :46-54, iron :64-70, coal :80-86, gold :96-104, silver :114-120, mithril :130-133, adamantite :143-146, runite :156-159, blurite :171-172, gem :182-183.
 * - `pack/loc.pack` maps each rock debugname to its loc id (`2091:2090=copperrock1`, `9709:9708=rocks_9708`).
 * - The 377 maps place both series; the rocks_97xx/111xxx/119xxx placements are the Rimmington, Crafting Guild and Barbarian Village fields (evidence RS2B0T-377-S9-1106/placements-rocks.txt, decoded from engine `data/pack/.cache/maps-server.zip`).
 * 289 carried only the classic 2090-2110 block; 377 adds the new-series ids the same tables name, so a camp's ore list can no longer assume two ids per ore.
 */
export const ROCK_TYPES: Record<string, number[]> = {
    Clay: [2108, 2109, 9711, 9713, 11189, 11190, 11191],
    Copper: [2090, 2091, 9708, 9709, 9710],
    Tin: [2094, 2095, 9714, 9716, 11933, 11934, 11935],
    Iron: [2092, 2093, 9717, 9718, 9719],
    Silver: [2100, 2101, 11186, 11187, 11188],
    Coal: [2096, 2097, 11930, 11931, 11932],
    Gold: [2098, 2099, 9720, 9722, 11183, 11184, 11185],
    Mithril: [2102, 2103],
    Adamantite: [2104, 2105],
    Runite: [2106, 2107]
};

/**
 * Quest-only rocks, kept out of `ROCK_OPTIONS`.
 * Why: an empty GatheringBot ore selection falls back to every option in `ROCK_OPTIONS`, and a mining bot should never target blurite.
 */
export const QUEST_ROCK_TYPES: Record<string, number[]> = {
    // mine.dbrow:169-178 `[blurite_rock]` names bluriterock (loc.pack:2111:2110) and macro_bluriterock; the macro form is the gas event state, not a target.
    Blurite: [2110]
    // The 289 edition also listed Limestone [4027, 4028, 4029]; the 377 mine tables have no limestone row, so no 377 source line backs it and it is dropped (pitfall 16).
};

export const ROCK_OPTIONS = Object.keys(ROCK_TYPES);

/** Ore ladder by mining level, best last. */
export const ROCK_TIER_ORDER: readonly string[] = Object.keys(ROCK_TYPES);

// Why: rock picking prefers the best tier in camp even when a lower tier is closer.
const ROCK_TIER_BY_ID: ReadonlyMap<number, number> = new Map(
    ROCK_TIER_ORDER.flatMap((name, tier) => ROCK_TYPES[name].map(id => [id, tier] as const))
);

/** Tier index for a rock loc id; higher is better, -1 for ids outside ROCK_TYPES. */
export function rockTierById(id: number): number {
    return ROCK_TIER_BY_ID.get(id) ?? -1;
}

/**
 * Gas-rock (macro event) loc ids: the loc a rock turns into when the smoking-rocks event fires.
 * 377 sources: `mine.dbrow` lists each `macro_*rock` beside its ore's rocks (:32-33 copper, :48-49 tin, :66-67 iron, :82-83 coal, :98-99 gold, :119-120 silver, :132-133 mithril, :145-146 adamantite, :158-159 runite, :14-15 clay, :172 blurite, :183 gem), and `pack/loc.pack` assigns the 2119-2140 block (`2120:2119=macro_copperrock1` … `2141:2140=macro_gemrock`).
 * 289 omitted 2140 (the gemrock gas form); the 377 gem table names it (`mine.dbrow:183`) and the 377 maps place gemrocks (Shilo Village, placements-rocks.txt), so it is guarded here.
 */
export const GAS_ROCK_IDS: Set<number> = new Set([
    2119, 2120, // macro_copperrock1/2
    2121, 2122, // macro_ironrock1/2
    2123, 2124, // macro_tinrock1/2
    2125, 2126, // macro_coalrock1/2
    2127, 2128, // macro_goldrock1/2
    2129, 2130, // macro_silverrock1/2
    2131, 2132, // macro_mithrilrock1/2
    2133, 2134, // macro_adamantiterock1/2
    2135, 2136, // macro_runiterock1/2
    2137, 2138, // macro_clayrock1/2
    2139, // macro_bluriterock
    2140 // macro_gemrock
]);

export const GAS_ROCK_TICKS = 60;

export const BROKEN_PICKAXE = 'Broken pickaxe';

export function resolveRockIds(names: string[]): Set<number> {
    const ids = new Set<number>();
    for (const name of names) {
        const key = ROCK_OPTIONS.find(k => k.toLowerCase() === name.trim().toLowerCase());
        if (key) {
            for (const id of ROCK_TYPES[key]) {
                ids.add(id);
            }
        }
    }
    return ids;
}
