import Tile from '#/bot/geometry/Tile.js';

/**
 * Hunt anchors for the kill-for-key medium riddles, one tile beside each killer's placed spawn; 377 source lines in docs/decisions/data-377-sources.md#kill-anchors.
 */
export const KILL_ANCHORS: Record<number, Tile> = {
    2831: new Tile(3039, 3700, 0), // riddle001, Black Heather, deep in the Wilderness
    2833: new Tile(2624, 3319, 0), // riddle002, Guard dog, Ardougne
    2835: new Tile(2635, 3339, 0), // riddle003, Guard, East Ardougne street
    2837: new Tile(2651, 3441, 0), // riddle004, Chicken pen NW of the Fishing Guild
    2839: new Tile(2596, 3106, 0) // riddle005, Man, Yanille ground floor
};
