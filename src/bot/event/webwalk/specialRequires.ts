/** Revision-377 plan-time requirements for catalogued navigation crossings and skill-gated doors. */

import { SPECIAL_CROSSINGS } from './data/specialCrossings.js';
import type { TransportRequires } from './types.js';

/** 377 placement coordinates come from doors.json / transports.json; handler requirements are from the cited 377 scripts. */
const DOOR_SKILL_GATES: readonly {
    x: number;
    z: number;
    level: number;
    skill: string;
    levelReq: number;
    /** Worn equipment required (plan-time). */
    worn?: { name: string; count: number }[];
    note?: string;
}[] = [
    // scripts/areas/area_falador/scripts/mining_guild.rs2:10-16: door entry requires mining 60.
    { x: 3046, z: 9756, level: 0, skill: 'mining', levelReq: 60 },
    // scripts/skill_fishing/scripts/fishing_guild.rs2:1-12: entry requires fishing 68.
    { x: 2611, z: 3394, level: 0, skill: 'fishing', levelReq: 68 },
    { x: 2611, z: 3398, level: 0, skill: 'fishing', levelReq: 68 },
    // scripts/areas/area_yanille/scripts/magic_guild.rs2:6-17: entry requires magic 66.
    { x: 2584, z: 3087, level: 0, skill: 'magic', levelReq: 66 },
    { x: 2584, z: 3088, level: 0, skill: 'magic', levelReq: 66 },
    { x: 2597, z: 3087, level: 0, skill: 'magic', levelReq: 66 },
    { x: 2597, z: 3088, level: 0, skill: 'magic', levelReq: 66 },
    // scripts/skill_crafting/scripts/crafting_guild/crafting_guild.rs2:1-18: crafting 40 and brown apron worn.
    { x: 2933, z: 3289, level: 0, skill: 'crafting', levelReq: 40 },
    // scripts/skill_cooking/scripts/cooking_guild.rs2:1-19: cooking 32 and chef's hat worn.
    {
        x: 3143,
        z: 3444,
        level: 0,
        skill: 'cooking',
        levelReq: 32,
        worn: [{ name: "Chef's hat", count: 1 }],
        note: "chef's hat worn"
    },
    // scripts/minigames/game_ranging/scripts/ranging_guild_door.rs2:17-34: ranged 40; the pack rows include loc and stands.
    { x: 2658, z: 3438, level: 0, skill: 'ranged', levelReq: 40 }
];

/** 377 transports.json from-tiles with handler skill gates; exit ladders remain open per server scripts. */
const TRANSPORT_SKILL_GATES: readonly {
    x: number;
    z: number;
    level: number;
    skill: string;
    levelReq: number;
}[] = [
    // scripts/areas/area_falador/scripts/mining_guild.rs2:1-8: mining 60 for the surface descent; the four stands are the cardinal tiles outside the ring of ladder 2113 placements.
    { x: 3017, z: 3339, level: 0, skill: 'mining', levelReq: 60 },
    { x: 3019, z: 3337, level: 0, skill: 'mining', levelReq: 60 },
    { x: 3019, z: 3341, level: 0, skill: 'mining', levelReq: 60 },
    { x: 3021, z: 3339, level: 0, skill: 'mining', levelReq: 60 },
    // scripts/skill_agility/scripts/shortcuts.rs2:112-122 gates `_island_rope_swing` except locId 2323 to avoid an island softlock.
    // 377 transport locIds: 2322 north swing, 2323 softlock swing, 2324 ogre swing; only the outer swings require 10.
    { x: 2709, z: 3209, level: 0, skill: 'agility', levelReq: 10 }, // tree_ropeswing1 north
    { x: 2511, z: 3091, level: 0, skill: 'agility', levelReq: 10 }, // tree_ropeswing3 ogre
    // scripts/minigames/game_ranging/scripts/ranging_guild_door.rs2:17-34: diagonal stands for the ranged-40 door.
    { x: 2657, z: 3439, level: 0, skill: 'ranged', levelReq: 40 },
    { x: 2659, z: 3437, level: 0, skill: 'ranged', levelReq: 40 }
];

// Why: key quest gates by edge origin, defer hidden post-quest stages to execution, and fail open without WorldState.
const CROSSING_GATES: readonly {
    x: number;
    z: number;
    level: number;
    quest?: string;
    minStatus?: 'started' | 'complete';
    /** Worn item the same handler demands (gas mask). */
    worn?: { name: string; count: number }[];
    /** Inventory item the handler checks without consuming. */
    items?: { name: string; count: number }[];
    /** Content script and the stage it tests. */
    note: string;
}[] = [
    // scripts/areas/area_mausoleum/scripts/gates.rs2:1-9; scripts/quests/quest_priestperil/configs/priestperil.constant:6.
    { x: 3405, z: 9895, level: 0, quest: 'Priest in Peril', minStatus: 'started', note: 'pip_underground_door1 needs %priestperil >= 5' },
    // Second door stage 8: scripts/areas/area_mausoleum/scripts/gates.rs2:4-5; scripts/quests/quest_priestperil/configs/priestperil.constant:9.
    { x: 3431, z: 9897, level: 0, quest: 'Priest in Peril', minStatus: 'started', note: 'pip_underground_door2 needs %priestperil >= 8' },
    // scripts/areas/area_mausoleum/scripts/holy_barrier.rs2:1-9: private stage 61 is one post-completion Drezel talk.
    { x: 3440, z: 9887, level: 0, quest: 'Priest in Peril', minStatus: 'complete', note: 'pip_underground_wall_side_withportal needs %priestperil = 61' },
    // scripts/quests/quest_elena/scripts/sewerpipe.rs2:1-16,32-43: opened pipe + gas mask worn; stage is execution-only.
    {
        x: 2514, z: 9739, level: 0, quest: 'Plague City', minStatus: 'started',
        worn: [{ name: 'Gas mask', count: 1 }],
        note: 'plaguesewerpipe_open needs the mask worn, not carried'
    },
    // scripts/quests/quest_desertrescue/scripts/quest_desertrescue.rs2:1-5,84-149: both gate halves check Metal key without consuming it.
    {
        x: 3273,
        z: 3028,
        level: 0,
        items: [{ name: 'Metal key', count: 1 }],
        note: 'miningcampgateclosedl needs the Metal key in inventory'
    },
    {
        x: 3274,
        z: 3028,
        level: 0,
        items: [{ name: 'Metal key', count: 1 }],
        note: 'miningcampgateclosedl needs the Metal key in inventory'
    },
    {
        x: 3273,
        z: 3029,
        level: 0,
        items: [{ name: 'Metal key', count: 1 }],
        note: 'miningcampgateclosedr needs the Metal key in inventory'
    },
    {
        x: 3274,
        z: 3029,
        level: 0,
        items: [{ name: 'Metal key', count: 1 }],
        note: 'miningcampgateclosedr needs the Metal key in inventory'
    }
];

// Match level first, then x/z for ships whose crossing is on deck L1 and stand on pier L0.
// Keep unlockQuest free-slot checks at execution time so a full pack can still plan the gate.

/** Plan-time requires for an edge origin tile. */
export function specialRequiresAt(x: number, z: number, level: number): TransportRequires | undefined {
    // A tile can carry more than one gate (the sewer pipe wants Plague City and the gas mask worn), so collect them all.
    const requires: TransportRequires = {};
    let gated = false;

    const atXz = SPECIAL_CROSSINGS.filter(s => s.x === x && s.z === z);
    const sc = atXz.find(s => s.level === level) ?? atXz[0];
    if (sc) {
        if (sc.requires) {
            requires.items = [{ name: sc.requires.item, count: sc.requires.count, consumed: true }];
            gated = true;
            // also currency form for tolls / ship fares
            if (sc.requires.item === 'Coins') {
                requires.currency = { name: 'Coins', amount: sc.requires.count };
            }
        }
        if (sc.questWaivesItems) {
            requires.questWaivesItems = sc.questWaivesItems;
        }
        if (sc.requiresSkill) {
            requires.skills = [{ name: sc.requiresSkill.name, level: sc.requiresSkill.level }];
            gated = true;
        }
        // unlockQuest-only rows (Mort Myre) contribute nothing at plan time; attaching their freeSlots would fail a full pack forever.
    }

    const door = DOOR_SKILL_GATES.find(d => d.x === x && d.z === z && d.level === level);
    if (door) {
        requires.skills = [{ name: door.skill, level: door.levelReq }];
        gated = true;
        if (door.worn && door.worn.length > 0) {
            requires.worn = door.worn.map(w => ({ name: w.name, count: w.count }));
        }
    }

    const tr = TRANSPORT_SKILL_GATES.find(d => d.x === x && d.z === z && d.level === level);
    if (tr) {
        requires.skills = [{ name: tr.skill, level: tr.levelReq }];
        gated = true;
    }

    const gate = CROSSING_GATES.find(q => q.x === x && q.z === z && q.level === level);
    if (gate) {
        gated = true;
        if (gate.quest && gate.minStatus) {
            requires.quests = [{ quest: gate.quest, minStatus: gate.minStatus }];
        }
        if (gate.items && gate.items.length > 0) {
            requires.items = [...(requires.items ?? []), ...gate.items.map(i => ({ ...i, consumed: false }))];
        }
        if (gate.worn && gate.worn.length > 0) {
            requires.worn = [...(requires.worn ?? []), ...gate.worn.map(w => ({ name: w.name, count: w.count }))];
        }
    }

    return gated ? requires : undefined;
}