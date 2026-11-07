import Tile from '#/bot/geometry/Tile.js';
import { CLUE_DB } from '#/bot/api/ai/clues/data/cluedb.js';
import type { NpcStop } from '#/bot/api/ai/quests/exec/primitives.js';

export const SPADE_NAME = 'Spade';
export const TRIO = ['Sextant', 'Watch', 'Chart'] as const;

export function trailKit(scrollId: number | null): string[] {
    if (scrollId === null) {
        return [];
    }
    return [SPADE_NAME, ...TRIO, ...(CLUE_DB[scrollId]?.items ?? [])];
}

/**
 * 377 ground spade spawns (content a15d0faa8): the 377 maps place five `spade` (obj 952) ground items
 * (`pack/obj.pack:953:952=spade`): East Ardougne (2566,3330) `maps/m40_52.jm2:7877`, south of Falador
 * (2981,3370) `maps/m46_52.jm2:14358`, Barbarian Village (3104,3359) `maps/m48_52.jm2:10665`, Varrock
 * palace upper floor (3234,3412,1) `maps/m50_53.jm2:12974` and the Karamja jungle (1951,4964)
 * `maps/m30_77.jm2:5620`. The 289 edition listed two spawns at (2574,3331) and (2981,3369); the 377
 * content placed the shop spades elsewhere, so both are re-derived from the 377 maps.
 */
export const SPADE_SPAWNS: Tile[] = [
    new Tile(2566, 3330, 0),
    new Tile(2981, 3370, 0),
    new Tile(3104, 3359, 0),
    new Tile(3234, 3412, 1),
    new Tile(1951, 4964, 0)
];

type CoordTool = 'sextant' | 'watch' | 'chart';

export interface HeldTrio {
    sextant: boolean;
    watch: boolean;
    chart: boolean;
}

export function nextCoordTool(held: HeldTrio): CoordTool | null {
    if (!held.sextant) {
        return 'sextant';
    }
    if (!held.watch) {
        return 'watch';
    }
    if (!held.chart) {
        return 'chart';
    }
    return null;
}

export const PROFESSOR: NpcStop = {
    npc: 'Observatory professor',
    anchor: new Tile(2438, 3186, 0),
    leash: 10,
    prefer: ['Treasure Trails', 'lost', 'navigation', 'sextant', 'watch']
};
export const MURPHY: NpcStop = {
    npc: 'Murphy',
    anchor: new Tile(2668, 3162, 0),
    leash: 10,
    prefer: ['sextant', 'lost']
};
export const KOJO: NpcStop = {
    npc: 'Brother Kojo',
    anchor: new Tile(2569, 3249, 0),
    leash: 10,
    prefer: ['watch', 'lost']
};
export const KOJO_EXIT = new Tile(2576, 3250, 0);

interface ShopSource {
    npc: string;
    stand: Tile;
    /** Rough coins per unit, so a caller can say why it could not buy. */
    cost: number;
}

// Why: a trail that rolls an `items` row must not be abandoned for want of an 18gp purchase.
// Why: only rows carrying `items` reach this, today `Rope` (2811, Baxtorian Falls), whose nearest stocked counter is Aemad's in East Ardougne, the same stand the Waterfall and Watch Tower quests use.

/** Shop counters for the extra items a clue row demands in `items`. */
const EXTRA_ITEM_SHOPS: Record<string, ShopSource> = {
    Rope: { npc: 'Aemad', stand: new Tile(2613, 3294, 0), cost: 18 }
};

export function extraItemShop(name: string): ShopSource | null {
    const key = Object.keys(EXTRA_ITEM_SHOPS).find(k => k.toLowerCase() === name.trim().toLowerCase());
    return key ? EXTRA_ITEM_SHOPS[key]! : null;
}

// Why: the Kharidian desert has one baked entrance and it eats a Shantay pass, so without one the desert leaves the graph and the leg reports `unreachable`.
// Why: Shantay stocks the pass himself (`shantaypass.inv` stock16, 5gp) and his counter is north of his own gate, so the trip is payable from the side the bot is stuck on.

/** Counters that sell a crossing toll, for the case where the bank had none. */
const GATE_ITEM_SHOPS: Record<string, ShopSource> = {
    'Shantay pass': { npc: 'Shantay', stand: new Tile(3304, 3122, 0), cost: 5 }
};

export function gateItemShop(name: string): ShopSource | null {
    const key = Object.keys(GATE_ITEM_SHOPS).find(k => k.toLowerCase() === name.trim().toLowerCase());
    return key ? GATE_ITEM_SHOPS[key]! : null;
}
