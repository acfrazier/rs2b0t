/** Spell and jewellery destinations reconstructed from revision 377 content. */
// Sources: scripts/skill_magic/configs/magic_spells.dbrow:62-114; scripts/skill_magic/scripts/spells/teleport.rs2:1-6.

import { ensureEdgeId } from './edgeId.js';
import { teleportEdgeCost } from './geometry/edgeCosts.js';
import type { NavPoint, TransportEdge, TransportRequires } from './types.js';
import { GLORY_MAX_WILDERNESS, SPELL_MAX_WILDERNESS, wildernessLevelAt } from './wilderness.js';

type TeleportFamily = 'spell' | 'jewellery' | 'lever';

/** Origin-side restrictions evaluated at the player's current tile (#339). */
interface TeleportOriginRequires {
    // Why: a player wildy level strictly greater than this is not planned.
    // Why: standard spells, duel ring and games neck sit at 20; glory sits at 30.

    /** Maximum wilderness level where this tele may be cast or rubbed. */
    maxWildernessLevel?: number;
}

export interface TeleportDestination {
    /** Stable id for PathPolicy.allowTeleportIds / edge.teleportId */
    teleportId: string;
    family: TeleportFamily;
    label: string;
    /** Approximate landing; server uses map_findsquare radius 2. */
    to: NavPoint;
    /** Fixed cost override; default {@link teleportEdgeCost}(family). */
    cost?: number;
    requires?: TransportRequires;
    /** Where the player may cast/rub from (wildy thresholds). */
    origin?: TeleportOriginRequires;
    /** Inventory item name substrings that satisfy the hop (any charge stage); spells use requires.items. */
    itemNameMatch?: string[];
    /** Chat option substrings to pick after Rub (jewellery); omit for single-dest items. */
    dialogueChoose?: string[];
    /** Debug / regenerate */
    source: string;
    notes?: string;
}

/** Placeholder from-tile for originless teles (ignored when attaching to player). */
const ORIGINLESS: NavPoint = { x: 0, z: 0, level: 0 };

const law = (n: number) => ({ name: 'Law rune', count: n, consumed: true as const });
const air = (n: number) => ({ name: 'Air rune', count: n, consumed: true as const });
const fire = (n: number) => ({ name: 'Fire rune', count: n, consumed: true as const });
const water = (n: number) => ({ name: 'Water rune', count: n, consumed: true as const });
const earth = (n: number) => ({ name: 'Earth rune', count: n, consumed: true as const });

/** Standard spellbook. Rune/level/landing rows are magic_spells.dbrow; teleport.rs2 dispatches these six spells. */
export const SPELL_TELEPORTS: readonly TeleportDestination[] = [
    {
        teleportId: 'varrock',
        family: 'spell',
        label: 'Varrock teleport',
        to: { x: 3213, z: 3424, level: 0 },
        requires: { skills: [{ name: 'magic', level: 25 }], items: [fire(1), air(3), law(1)] },
        origin: { maxWildernessLevel: SPELL_MAX_WILDERNESS },
        source: 'magic_spell_teleport_varrock'
    },
    {
        teleportId: 'lumbridge',
        family: 'spell',
        label: 'Lumbridge teleport',
        to: { x: 3221, z: 3218, level: 0 },
        requires: { skills: [{ name: 'magic', level: 31 }], items: [earth(1), air(3), law(1)] },
        origin: { maxWildernessLevel: SPELL_MAX_WILDERNESS },
        source: 'magic_spell_teleport_lumbridge'
    },
    {
        teleportId: 'falador',
        family: 'spell',
        label: 'Falador teleport',
        to: { x: 2965, z: 3378, level: 0 },
        requires: { skills: [{ name: 'magic', level: 37 }], items: [water(1), air(3), law(1)] },
        origin: { maxWildernessLevel: SPELL_MAX_WILDERNESS },
        source: 'magic_spell_teleport_falador'
    },
    {
        teleportId: 'camelot',
        family: 'spell',
        label: 'Camelot teleport',
        to: { x: 2757, z: 3478, level: 0 },
        requires: {
            members: true,
            skills: [{ name: 'magic', level: 45 }],
            items: [air(5), law(1)]
        },
        origin: { maxWildernessLevel: SPELL_MAX_WILDERNESS },
        source: 'magic_spell_teleport_camelot'
    },
    {
        teleportId: 'ardougne',
        family: 'spell',
        label: 'Ardougne teleport',
        to: { x: 2661, z: 3301, level: 0 },
        requires: {
            members: true,
            skills: [{ name: 'magic', level: 51 }],
            items: [water(2), law(2)],
            // Journal display name (questlist.if); alias "Plague City" also resolves.
            quests: [{ quest: 'Plague City', minStatus: 'complete' }]
        },
        origin: { maxWildernessLevel: SPELL_MAX_WILDERNESS },
        source: 'magic_spell_teleport_ardougne',
        notes: 'Also requires having read the unlock scroll (elenaquest complete_read_scroll).'
    },
    {
        teleportId: 'watchtower',
        family: 'spell',
        label: 'Watchtower teleport',
        to: { x: 2933, z: 4713, level: 2 },
        requires: {
            members: true,
            skills: [{ name: 'magic', level: 58 }],
            items: [earth(2), law(2)],
            // Journal display name is "Watch Tower" (questlist.if); alias still resolves.
            quests: [{ quest: 'Watch Tower', minStatus: 'complete' }]
        },
        origin: { maxWildernessLevel: SPELL_MAX_WILDERNESS },
        source: 'magic_spell_teleport_watchtower',
        notes: 'Landing is level 2; requires Watchtower complete + scroll. Cast via Game.teleport.'
    },
];

/** Jewellery destinations implemented by the revision 377 item scripts. */
// Ring choices: scripts/general/scripts/enchanted_jewellry/ring_of_dueling.rs2:7,21-27; item members flag: scripts/_unpack/377/all.obj:28645-28665.
// Games-neck choice/members flag: scripts/general/scripts/enchanted_jewellry/necklace_of_minigames.rs2:1-21; scripts/_unpack/377/all.obj:47170-47191.
export const JEWELLERY_TELEPORTS: readonly TeleportDestination[] = [
    {
        teleportId: 'dueling_arena',
        family: 'jewellery',
        label: 'Ring of dueling → Al Kharid Duel Arena',
        to: { x: 3315, z: 3235, level: 0 },
        requires: { members: true },
        itemNameMatch: ['Ring of dueling'],
        dialogueChoose: ['Al Kharid', 'Duel Arena'],
        origin: { maxWildernessLevel: SPELL_MAX_WILDERNESS },
        source: 'scripts/general/scripts/enchanted_jewellry/ring_of_dueling.rs2:7,21-27',
        notes: 'Charges 8→1. Inventory Rub only. Wildy >20 blocked. Both Duel Arena and Castle Wars options.'
    },
    {
        teleportId: 'dueling_castle_wars',
        family: 'jewellery',
        label: 'Ring of dueling → Castle Wars',
        to: { x: 2441, z: 3090, level: 0 },
        requires: { members: true },
        itemNameMatch: ['Ring of dueling'],
        dialogueChoose: ['Castle Wars'],
        origin: { maxWildernessLevel: SPELL_MAX_WILDERNESS },
        source: 'scripts/general/scripts/enchanted_jewellry/ring_of_dueling.rs2:7,21-27',
        notes: 'Charges 8→1. Inventory Rub only. Wildy >20 blocked.'
    },
    {
        teleportId: 'games_burthorpe',
        family: 'jewellery',
        label: 'Games necklace → Burthorpe Games Room',
        to: { x: 2207, z: 4940, level: 0 },
        requires: { members: true },
        itemNameMatch: ['Games necklace'],
        dialogueChoose: ['Burthorpe', 'Games Room'],
        origin: { maxWildernessLevel: SPELL_MAX_WILDERNESS },
        source: 'scripts/general/scripts/enchanted_jewellry/necklace_of_minigames.rs2:7,21',
        notes: 'Charges 8→1. Inventory Rub only. Wildy >20 blocked. Burthorpe only on this server.'
    },
    {
        teleportId: 'glory_edgeville',
        family: 'jewellery',
        label: 'Amulet of glory → Edgeville',
        to: { x: 3087, z: 3496, level: 0 },
        itemNameMatch: ['Amulet of glory('],
        dialogueChoose: ['Edgeville'],
        origin: { maxWildernessLevel: GLORY_MAX_WILDERNESS },
        source: 'scripts/general/scripts/enchanted_jewellry/amulet_of_glory.rs2:13,30',
        notes: 'Requires charged glory (1–4). Wildy >30 blocked. Inventory Rub only.'
    },
    {
        teleportId: 'glory_karamja',
        family: 'jewellery',
        label: 'Amulet of glory → Karamja',
        to: { x: 2918, z: 3176, level: 0 },
        itemNameMatch: ['Amulet of glory('],
        dialogueChoose: ['Karamja'],
        origin: { maxWildernessLevel: GLORY_MAX_WILDERNESS },
        source: 'scripts/general/scripts/enchanted_jewellry/amulet_of_glory.rs2:13,31'
    },
    {
        teleportId: 'glory_draynor',
        family: 'jewellery',
        label: 'Amulet of glory → Draynor Village',
        to: { x: 3105, z: 3251, level: 0 },
        itemNameMatch: ['Amulet of glory('],
        dialogueChoose: ['Draynor'],
        origin: { maxWildernessLevel: GLORY_MAX_WILDERNESS },
        source: 'scripts/general/scripts/enchanted_jewellry/amulet_of_glory.rs2:13,32'
    },
    {
        teleportId: 'glory_alkharid',
        family: 'jewellery',
        label: 'Amulet of glory → Al Kharid',
        to: { x: 3293, z: 3163, level: 0 },
        itemNameMatch: ['Amulet of glory('],
        dialogueChoose: ['Al Kharid'],
        origin: { maxWildernessLevel: GLORY_MAX_WILDERNESS },
        source: 'scripts/general/scripts/enchanted_jewellry/amulet_of_glory.rs2:13,33'
    }
];

/** Loc-backed levers, listed for completeness; compile as loc edges later. */
export const LEVER_TELEPORTS: readonly TeleportDestination[] = [
    {
        teleportId: 'lever_ardougne_to_wild',
        family: 'lever',
        label: 'Ardougne wilderness lever (in)',
        to: { x: 3154, z: 3924, level: 0 },
        source: 'scripts/areas/area_ardougne_east/configs/wilderness_lever.constant:1-2; scripts/areas/area_ardougne_east/scripts/wilderness_lever.rs2:28',
        notes: 'Walk to lever loc; warning dialog. Exact deep-wild teleport landing.'
    },
    {
        teleportId: 'lever_wild_to_ardougne',
        family: 'lever',
        label: 'Wilderness lever (out to Ardougne)',
        to: { x: 2562, z: 3311, level: 0 },
        source: 'scripts/areas/area_ardougne_east/scripts/wilderness_lever.rs2:44'
    }
];

export const ALL_TELEPORT_DESTINATIONS: readonly TeleportDestination[] = [
    ...SPELL_TELEPORTS,
    ...JEWELLERY_TELEPORTS,
    ...LEVER_TELEPORTS
];

/** Lookup by teleportId (spell or jewellery). */
export function teleportById(id: string): TeleportDestination | undefined {
    return ALL_TELEPORT_DESTINATIONS.find(d => d.teleportId === id);
}

/** Originless spell + jewellery rows as TransportEdges for future graph load. */
export function teleportDestinationsToEdges(
    dests: readonly TeleportDestination[] = [...SPELL_TELEPORTS, ...JEWELLERY_TELEPORTS]
): TransportEdge[] {
    return dests
        .filter(d => d.family === 'spell' || d.family === 'jewellery')
        .map(d => {
            const partial = {
                from: ORIGINLESS,
                to: d.to,
                kind: 'teleport' as const,
                cost: d.cost ?? teleportEdgeCost(d.family),
                landing: { toTile: d.to, acceptAnyLanding: true },
                requires: d.requires,
                teleportId: d.teleportId,
                debug: { name: d.label, source: d.source }
            };
            return { ...partial, id: ensureEdgeId(partial) };
        });
}

/** True if inv name can pay for a jewellery tele (charge stages share prefix). */
export function inventoryNameMatchesJewellery(itemName: string, dest: TeleportDestination): boolean {
    if (!dest.itemNameMatch?.length) {
        return false;
    }
    return dest.itemNameMatch.some(prefix => itemName.includes(prefix));
}

// Why: it fails closed when `maxWildernessLevel` is set and the player's wildy level is strictly greater (#339).

/** Whether `dest` may be used from `from`, given wildy on state or computed from coordinates. */
export function teleportAllowedFromOrigin(
    dest: TeleportDestination,
    from: NavPoint,
    wildyLevel?: number
): { ok: true } | { ok: false; reason: string } {
    const max = dest.origin?.maxWildernessLevel;
    if (max === undefined) {
        return { ok: true };
    }
    const level = wildyLevel ?? wildernessLevelAt(from);
    if (level > max) {
        return {
            ok: false,
            reason: `${dest.teleportId} blocked at wilderness level ${level} (max ${max})`
        };
    }
    return { ok: true };
}