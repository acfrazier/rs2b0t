import Tile from '../geometry/Tile.js';

export interface RuneRoute {
    rune: string;
    talisman: string;
    level: number;
    bank: string;
    ruins: Tile;
}

/**
 * 377 sources (content a15d0faa8): every `ruins` tile is the `exit_coord` of the rune's row in
 * `scripts/skill_runecraft/configs/runecraft.dbrow` (air :13, mind :27, water :41, earth :55, fire :69,
 * body :83, cosmic :101, chaos :116-124, nature :139, law :154, death :167), cross-checked against the
 * `<rune>temple_ruined` loc the 377 maps place (`pack/loc.pack:2453-2463`; placements in
 * RS2B0T-377-S9-1106/placements-rocks.txt). Two tiles changed from 289, where the 289 content's dbrow
 * pointed cosmic and death into the altar realm:
 * - Cosmic: 289 (3173,9501) → 377 (2406,4380), the Zanaris ruins beside cosmictemple_ruined
 *   (maps/m37_68.jm2:5816, ruins SW (2407,4376)).
 * - Death: 289 (3221,3218) → 377 (1862,4639), the tile east of deathtemple_ruined (maps/m29_72.jm2:12379,
 *   ruins SW (1859,4638)).
 */

/* Rune altar locations decoded from `runecraft.dbrow`; `exit_coord` is level_chunkX_chunkZ_offsetX_offsetZ with 64-tile chunks. */
export const RUNES: Record<string, RuneRoute> = {
    'Air rune': {
        rune: 'Air rune',
        talisman: 'Air talisman',
        level: 1,
        bank: 'Falador East',
        ruins: new Tile(2983, 3288, 0)
    },
    'Mind rune': {
        rune: 'Mind rune',
        talisman: 'Mind talisman',
        level: 2,
        bank: 'Edgeville',
        ruins: new Tile(2980, 3511, 0)
    },
    'Water rune': {
        rune: 'Water rune',
        talisman: 'Water talisman',
        level: 5,
        bank: 'Draynor',
        ruins: new Tile(3182, 3162, 0)
    },
    'Earth rune': {
        rune: 'Earth rune',
        talisman: 'Earth talisman',
        level: 9,
        bank: 'Varrock East',
        ruins: new Tile(3303, 3477, 0)
    },
    'Fire rune': {
        rune: 'Fire rune',
        talisman: 'Fire talisman',
        level: 14,
        bank: 'Al Kharid',
        ruins: new Tile(3310, 3252, 0)
    },
    'Body rune': {
        rune: 'Body rune',
        talisman: 'Body talisman',
        level: 20,
        bank: 'Edgeville',
        ruins: new Tile(3050, 3442, 0)
    },
    'Cosmic rune': {
        rune: 'Cosmic rune',
        talisman: 'Cosmic talisman',
        level: 27,
        bank: 'Draynor',
        // 377: runecraft.dbrow:101 exit_coord `0_37_68_38_28`, the Zanaris ruins east of cosmictemple_ruined (maps/m37_68.jm2:5816).
        ruins: new Tile(2406, 4380, 0)
    },
    'Chaos rune': {
        rune: 'Chaos rune',
        talisman: 'Chaos talisman',
        level: 35,
        bank: 'Edgeville',
        ruins: new Tile(3060, 3585, 0)
    },
    'Nature rune': {
        rune: 'Nature rune',
        talisman: 'Nature talisman',
        level: 44,
        bank: 'Draynor',
        ruins: new Tile(2865, 3022, 0)
    },
    'Law rune': {
        rune: 'Law rune',
        talisman: 'Law talisman',
        level: 54,
        bank: 'Catherby',
        ruins: new Tile(2858, 3378, 0)
    },
    'Death rune': {
        rune: 'Death rune',
        talisman: 'Death talisman',
        level: 65,
        bank: 'Edgeville',
        // 377: runecraft.dbrow:167 exit_coord `0_29_72_6_31`, the tile east of deathtemple_ruined (maps/m29_72.jm2:12379).
        ruins: new Tile(1862, 4639, 0)
    }
};

export type RuneType = keyof typeof RUNES;
export const RUNE_OPTIONS: string[] = Object.keys(RUNES);
export const DEFAULT_RUNE: string = 'Air rune';
