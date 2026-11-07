import type { ItemAlias } from '../api/market/aliasTypes.js';

/**
 * User-facing aliases that cannot be derived from object debugnames. @see tools/items/gen-namecollisions.ts
 *
 * 377 sources (content a15d0faa8): the generated nameCollisions groups decide which families still collide.
 * The 289 edition also aliased the dragonhide family (1745/1065/1099/1135) and the unstrung bows (48-72);
 * the 377 content names every member distinctly, so those groups no longer exist and their aliases are
 * dropped with the 377 lines that rename them (pitfall 16: no constant without a 377 source line):
 * - Unstrung bows carry their own "(u)" names (`_unpack/377/all.obj`: `name=Oak longbow (u)` :743,
 *   `name=Maple longbow (u)` :803, `name=Magic shortbow (u)` :903, …), so they no longer collide with the
 *   strung bow; the 377 Oak longbow group pairs the signed variant (4236) instead, which the generated
 *   `signed` word already separates.
 * - Dragonhide pieces carry per-color names (`name=Green d'hide body` :14517, `name=Green d'hide chaps` :13965,
 *   `name=Green d'hide vamb` :13444, `name=Green d-leather` :23393), so the 289 "Dragonhide"/"Dragon leather"
 *   groups have no 377 rows and customers type the distinct names directly.
 */
export const ITEM_ALIASES: Readonly<Record<number, ItemAlias>> = {
    // Crystal key halves. Both objs carry the same name and the same desc, differing only in model.
// The loop/tooth wording appears only in the 377 descs (`_unpack/377/all.obj`: keyhalf1
// `desc=The tooth end of the mysterious Crystal Key…` :12500, keyhalf2 `desc=The loop end…` :12516);
// the 377 collision group "Half of a key" pairs keyhalf1 985 with keyhalf2 987.
    985: { words: ['tooth'], label: 'Tooth half of key' },
    987: { words: ['loop'], label: 'Loop half of key' },

    // Holy book page debugnames differ by an internal single-letter code.
    // 377 ids from `pack/obj.pack` (`3828:3827=holy_book_s_page1` … `3839:3838=holy_book_g_page4`);
    // the display names are the 377 content's own (`_unpack/377/all.obj` `name=Torn page 1(s)` :46576 … :46840).
    3827: { words: ['saradomin', 'sara'], label: 'Saradomin torn page 1' },
    3828: { words: ['saradomin', 'sara'], label: 'Saradomin torn page 2' },
    3829: { words: ['saradomin', 'sara'], label: 'Saradomin torn page 3' },
    3830: { words: ['saradomin', 'sara'], label: 'Saradomin torn page 4' },
    3831: { words: ['zamorak', 'zammy'], label: 'Zamorak torn page 1' },
    3832: { words: ['zamorak', 'zammy'], label: 'Zamorak torn page 2' },
    3833: { words: ['zamorak', 'zammy'], label: 'Zamorak torn page 3' },
    3834: { words: ['zamorak', 'zammy'], label: 'Zamorak torn page 4' },
    3835: { words: ['guthix'], label: 'Guthix torn page 1' },
    3836: { words: ['guthix'], label: 'Guthix torn page 2' },
    3837: { words: ['guthix'], label: 'Guthix torn page 3' },
    3838: { words: ['guthix'], label: 'Guthix torn page 4' },

    // Strung and unstrung amulets share a name; use natural label order.
    // 377 collision groups (staged nameCollisions.ts) keep every pair: Gold [1673,1692], Sapphire [1675,1694],
    // Emerald [1677,1696,+6041 magic strung], Ruby [1679,1698], Diamond [1681,1700],
    // Dragonstone ammy [1683,1702]: the 377 name for the 289 "Dragonstoneamulet" group (`all.obj` `name=Dragonstone ammy` :22547).
    1673: { words: ['unstrung'], label: 'Gold amulet (u)' },
    1675: { words: ['unstrung'], label: 'Sapphire amulet (u)' },
    1677: { words: ['unstrung'], label: 'Emerald amulet (u)' },
    1679: { words: ['unstrung'], label: 'Ruby amulet (u)' },
    1681: { words: ['unstrung'], label: 'Diamond amulet (u)' },
    1683: { words: ['unstrung'], label: 'Dragonstone amulet (u)' },
    1692: { words: ['strung'], label: 'Gold amulet' },
    1694: { words: ['strung'], label: 'Sapphire amulet' },
    1696: { words: ['strung'], label: 'Emerald amulet' },
    1698: { words: ['strung'], label: 'Ruby amulet' },
    1700: { words: ['strung'], label: 'Diamond amulet' },
    1702: { words: ['strung'], label: 'Dragonstone amulet' }
};

/** Shorthand a customer types instead of the display name, keyed by the lowercased name. */
// Common trade shorthand; every key must be a name the 377 content repeats (a collision group name).
// The 289 dragonhide-family shorthand keys are gone with their 377 collision groups; the Dragonstone shorthand
// retargets to the 377 group name "Dragonstone ammy" (`all.obj` `name=Dragonstone ammy` :22547).
export const NAME_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
    'half of a key': ['half key', 'key half'],
    'sapphire amulet': ['sapp amulet', 'sapp ammy'],
    'emerald amulet': ['emmy amulet', 'emerald ammy'],
    'dragonstone ammy': ['dragonstone amulet', 'dstone amulet', 'dstone ammy']
};
