import Tile from '#/bot/geometry/Tile.js';

/**
 * Hunt anchors for the kill-for-key medium riddles, one tile beside each killer's placed spawn.
 *
 * 377 sources (content a15d0faa8):
 * - The five riddles and their key drops: `scripts/minigames/game_trail/scripts/medium/trail_clue_medium.rs2:29-37` —
 *   `npc_type = black_heather` :29, `npc_type = guarddog` :31, `npc_type = ardougne_guard` :33,
 *   `npc_category = chicken` :35, `compare(npc_name, "Man")` :37.
 * - Clue item ids from `pack/obj.pack` (`2832:2831=trail_clue_medium_riddle001` … `2841:2840=trail_clue_medium_riddle005_key`), also carried in the staged cluedb keyFrom rows.
 * - The killer spawns are the 377 map placements: `maps/m47_57.jm2:7825` (black_heather 202 @ 3039,3700),
 *   `maps/m41_51.jm2:11006` (guarddog 99 @ 2624,3319), `maps/m41_52.jm2:7695` (ardougne_guard 32 @ 2635,3339),
 *   `maps/m41_53.jm2:7773-7777` (the chicken 41 pen @ 2650-2651, 3441-3442), `maps/m40_48.jm2:9537` (man3 @ 2596,3106).
 *
 * 289 also carried riddle007 (Pirate, Brimhaven docks) and riddle008 (Penda, Barbarian Outpost); the 377
 * trail has no riddle007/riddle008 rows (`trail_clue_medium.rs2` ends at riddle005, and gen-cluedb marks
 * 007/008 289-only), so those two anchors are dropped (pitfall 16: no constant without a 377 source line).
 */
export const KILL_ANCHORS: Record<number, Tile> = {
    2831: new Tile(3039, 3700, 0), // riddle001, Black Heather, deep in the Wilderness
    2833: new Tile(2624, 3319, 0), // riddle002, Guard dog, Ardougne
    2835: new Tile(2635, 3339, 0), // riddle003, Guard, East Ardougne street
    2837: new Tile(2651, 3441, 0), // riddle004, Chicken pen NW of the Fishing Guild
    2839: new Tile(2596, 3106, 0) // riddle005, Man, Yanille ground floor
};
