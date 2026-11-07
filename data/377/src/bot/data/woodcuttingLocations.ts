import type { WorldTile } from '../adapter/ClientAdapter.js';
import Tile from '../geometry/Tile.js';
import {
    locationOptions,
    resolveGatheringLocation,
    type GatheringLocation
} from './gatheringLocations.js';

/** Woodcutting camps from rs2b2tgathering.csv and live checks. Burn strips remain in FiremakingLogic. */
export type WoodcuttingLocation = GatheringLocation;

/**
 * Ent NPCs: the 377 pack's macro_ent_* ids (`pack/npc.pack:1720-1751,1792-1793`: tree1-6 1719/1720/1721/1744/1747/1748,
 * dead_tree1-11 1722-1732 + dead_tree12 1745, dramen 1733, magic 1734, maple 1735, willow1-3 1736-1738, oak 1739, yew 1740,
 * evergreen1-3 1741-1743, achey 1746, hollow1-2 1749-1750, jungle_tree1-2 1791-1792).
 * Why: Ents share tree names and Chop down actions, so match by ID.
 * Why the 289 ids are gone: pack ids depend on build history (pitfall 11); the 289 pack numbered them 444-452,
 * the 377 pack numbers them 1719-1750 and 1791-1792, with crow (1751+) the next id after hollow2.
 */
export const ENT_NPC_IDS: Set<number> = new Set([
    1719, 1720, 1721, // macro_ent_tree1..3
    1722, 1723, 1724, 1725, 1726, 1727, 1728, 1729, 1730, 1731, 1732, 1745, // macro_ent_dead_tree1..12
    1733, // macro_ent_dramen
    1734, 1735, // macro_ent_magic, macro_ent_maple
    1736, 1737, 1738, // macro_ent_willow1..3
    1739, 1740, // macro_ent_oak, macro_ent_yew
    1741, 1742, 1743, // macro_ent_evergreen1..3
    1744, 1747, 1748, // macro_ent_tree4..6
    1746, // macro_ent_achey
    1749, 1750, // macro_ent_hollow1..2
    1791, 1792 // macro_ent_jungle_tree1..2
]);

/** Ent despawn timer in ticks. Same length as a smoking rock. */
export const ENT_LIFE_TICKS = 60;

export function isEntNpcId(id: number): boolean {
    return ENT_NPC_IDS.has(id);
}

export function entNpcOnTile(
    npcs: readonly { id: number; tile: { x: number; z: number; level: number } }[],
    tile: { x: number; z: number; level: number }
): boolean {
    return npcs.some(
        n => isEntNpcId(n.id) && n.tile.x === tile.x && n.tile.z === tile.z && n.tile.level === tile.level
    );
}

const BANK = {
    draynor: new Tile(3093, 3243, 0),
    seers: new Tile(2725, 3491, 0),
    edgeville: new Tile(3094, 3493, 0),
    faladorWest: new Tile(2946, 3369, 0),
    ardougneWest: new Tile(2616, 3332, 0),
    grandTree: new Tile(2449, 3482, 1)
} as const;

function camp(
    name: string,
    spot: Tile,
    bankStand: Tile,
    resources: readonly string[],
    notes?: string,
    verified = true
): WoodcuttingLocation {
    return {
        name,
        spot,
        bankStand,
        boothName: 'Bank booth',
        boothOp: 'Use-quickly',
        verified,
        resources,
        notes
    };
}

export const WOODCUTTING_LOCATIONS: WoodcuttingLocation[] = [
    camp(
        'Draynor (trees)',
        new Tile(3098, 3242, 0),
        BANK.draynor,
        ['logs'],
        'Normal trees near Draynor bank'
    ),
    camp(
        'Draynor Oaks',
        new Tile(3105, 3245, 0),
        BANK.draynor,
        ['oak'],
        'East of Draynor bank'
    ),
    camp(
        'Draynor Willows',
        new Tile(3087, 3234, 0),
        BANK.draynor,
        ['willow'],
        'Southwest of Draynor bank'
    ),
    camp(
        'Seers (trees)',
        new Tile(2724, 3474, 0),
        BANK.seers,
        ['logs'],
        'South of Seers bank'
    ),
    camp(
        'Seers Oaks',
        new Tile(2721, 3483, 0),
        BANK.seers,
        ['oak'],
        'Just SW/S of Seers bank door'
    ),
    camp(
        'Seers Willows',
        new Tile(2711, 3500, 0),
        BANK.seers,
        ['willow'],
        'Northwest of Seers bank'
    ),
    camp(
        'Seers Maples',
        new Tile(2728, 3501, 0),
        BANK.seers,
        ['maple'],
        'North of Seers bank'
    ),
    camp(
        'Seers Yews (cemetery)',
        // Previous 2735,3462 was party-room area; church/cemetery is further SW.
        new Tile(2708, 3462, 0),
        BANK.seers,
        ['yew'],
        'Church/cemetery SW of Seers (not party room)'
    ),
    camp(
        'Edgeville Yews',
        new Tile(3087, 3470, 0),
        BANK.edgeville,
        ['yew'],
        'South of Edgeville bank'
    ),
    camp(
        "Sorcerer's Tower",
        new Tile(2702, 3398, 0),
        BANK.seers,
        ['magic'],
        'Magic trees south of Sorcerer\'s Tower / far south of Seers'
    ),
    camp(
        'Gnome Stronghold',
        new Tile(2434, 3425, 0),
        BANK.grandTree,
        ['magic'],
        'Bank is Grand Tree 1F booths (open, no quest gate) — seed stand'
    ),
    // Tick-manip camps, unpolished until live path/resource checks (#160).
    camp(
        'S Falador Oaks',
        // Oaks south of Falador walls (about 2949 to 3002, 3267 to 3314). Chickens near 2966,3346 for 2t retaliate.
        new Tile(2976, 3290, 0),
        BANK.faladorWest,
        ['oak'],
        'Tick manip: 2t retaliate oaks (chickens nearby). Unverified seed.',
        false
    ),
    camp(
        'Lumbridge Farmer Willows',
        // Sheep-farm willows + farmer (~3221,3290 / farmer ~3227,3290). Bank Draynor.
        new Tile(3221, 3290, 0),
        BANK.draynor,
        ['willow'],
        'Tick manip: 3t farmer willows (6-tick cycle). Unverified seed.',
        false
    ),
    camp(
        'Lumbridge Castle Willows',
        // Castle willows 3233 to 3234, 3238 to 3244, plus rats for retaliate methods.
        new Tile(3233, 3241, 0),
        BANK.draynor,
        ['willow'],
        'Tick manip: 3t shortbow rapid / retaliate willows. Unverified seed.',
        false
    )
];

export const WOODCUTTING_LOCATION_OPTIONS = locationOptions(WOODCUTTING_LOCATIONS);

export function resolveWoodcuttingLocation(
    setting: string,
    startTile: WorldTile
): WoodcuttingLocation | null {
    return resolveGatheringLocation(setting, startTile, WOODCUTTING_LOCATIONS);
}
