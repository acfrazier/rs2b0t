import type { ItemAlias } from '../api/market/aliasTypes.js';

/**
 * User-facing aliases that cannot be derived from object debugnames. @see tools/items/gen-namecollisions.ts
 * 377 source lines for every family: docs/decisions/data-377-sources.md#item-aliases.
 */
export const ITEM_ALIASES: Readonly<Record<number, ItemAlias>> = {
    // Crystal key halves: same name and desc, told apart by the 377 loop and tooth wording (`all.obj` keyhalf1 :12500, keyhalf2 :12516).
    985: { words: ['tooth'], label: 'Tooth half of key' },
    987: { words: ['loop'], label: 'Loop half of key' },

    // Holy book page debugnames differ by an internal single-letter code; ids and names are 377 (`pack/obj.pack` 3828-3839, `all.obj` :46576-:46840).
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

    // Strung and unstrung amulets share a name; use natural label order. 377 collision groups keep every pair (Dragonstone ammy is `all.obj` :22547),
    // and the three-member Emerald group defeats the two-way split, so 1696 keeps the generated "Strung emerald amulet" label.
    1673: { words: ['unstrung'], label: 'Gold amulet (u)' },
    1675: { words: ['unstrung'], label: 'Sapphire amulet (u)' },
    1677: { words: ['unstrung'], label: 'Emerald amulet (u)' },
    1679: { words: ['unstrung'], label: 'Ruby amulet (u)' },
    1681: { words: ['unstrung'], label: 'Diamond amulet (u)' },
    1683: { words: ['unstrung'], label: 'Dragonstone amulet (u)' },
    1692: { words: ['strung'], label: 'Gold amulet' },
    1694: { words: ['strung'], label: 'Sapphire amulet' },
    1698: { words: ['strung'], label: 'Ruby amulet' },
    1700: { words: ['strung'], label: 'Diamond amulet' },
    1702: { words: ['strung'], label: 'Dragonstone amulet' }
};

/** Shorthand a customer types instead of the display name, keyed by the lowercased name. */
// Common trade shorthand; every key must be a name the 377 content repeats (a collision group name), so Dragonstone targets "Dragonstone ammy".
export const NAME_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
    'half of a key': ['half key', 'key half'],
    'sapphire amulet': ['sapp amulet', 'sapp ammy'],
    'emerald amulet': ['emmy amulet', 'emerald ammy'],
    'dragonstone ammy': ['dragonstone amulet', 'dstone amulet', 'dstone ammy']
};
