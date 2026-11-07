[Manual](../README.md) › 377 data sources

# Source lines behind the 377 data editions

Pitfall 16 of the 377 plan: no constant ships without a 377 source line. The evidence for each
hand-authored edition lives here so the modules keep one-line comments. Content commit
`a15d0faa8`; `all.obj`, `all.loc` and `all.npc` are `scripts/_unpack/377/`.

## Clue gates

The 289 rows (3560, 3562, 3564: the Isafdar dig and elf-camp clues) have no 377 clue items. The
377 trail content (`all.obj`, 367 `trail_clue*` objs) carries no Isafdar clue, and the staged
cluedb (2677-2858) has no such ids. A row for a clue the content does not sell would be a stale
gate that the audit reports, so the table is empty.

## Kill anchors

- The five riddles and their key drops: `scripts/minigames/game_trail/scripts/medium/trail_clue_medium.rs2:29-37`:
  `npc_type = black_heather` :29, `guarddog` :31, `ardougne_guard` :33, `npc_category = chicken` :35, `compare(npc_name, "Man")` :37.
- Clue ids from `pack/obj.pack` (`2832:2831=trail_clue_medium_riddle001` to `2841:2840=trail_clue_medium_riddle005_key`), also in the staged cluedb keyFrom rows.
- Killer spawns are 377 map placements: `maps/m47_57.jm2:7825` (black_heather 202 at 3039,3700), `m41_51.jm2:11006` (guarddog 99 at 2624,3319), `m41_52.jm2:7695` (ardougne_guard 32 at 2635,3339), `m41_53.jm2:7773-7777` (chicken 41 pen at 2650-2651, 3441-3442), `m40_48.jm2:9537` (man3 at 2596,3106).
- 289 also carried riddle007 (Pirate, Brimhaven docks) and riddle008 (Penda, Barbarian Outpost). The 377 trail ends at riddle005 and `gen-cluedb` marks 007 and 008 as 289-only, so both anchors are dropped.

## Spade spawns

Five ground spades (obj 952, `pack/obj.pack:953:952=spade`) from the OBJ sections of `maps/*.jm2`:
(1951,4964,0) `m30_77:5620`, (2566,3330,0) `m40_52:7877`, (2981,3370,0) `m46_52:14358`,
(3120,3359,0) `m48_52:10665`, (3218,3412,1) `m50_53:12974`. The 289 edition's two alternate spawns are not in the 377 placements.

## Cook locations

The surfaces pair with the generated `cookSurfaceLocs.ts` (the 377 placements of `cooking_sources.loc`, 121 surfaces).
Every curated loc exists in the 377 pack: Catherby range (2817,3444), Seers village range (2715,3476), Sinclair pier range (2733,3582),
Fishing Guild range (2616,3396), Draynor fireplace (3100,3256), and the Barbarian Village fires (loc 2732 `fire` at 3078-3079,3445, `pack/loc.pack:2733:2732=fire`). No tile changed from 289.

## Cow killer locations

Cow spawns are the 377 placements of the Cow-named npcs: `pack/npc.pack` cow 81 (:82), cow2 397 (:398), cow3 1767 (:1769), calves 1766/1768.
Placed in `maps/m50_51.jm2:7962-7980` (Lumbridge field), `m49_51.jm2:7393-7416` (north-west field), `m47_51.jm2:7577-7589` (south of Falador),
and `m41_52.jm2:7825` area (East Ardougne; the ten id-81 spawns the test enumerates). Tiles match the 289 scouting, re-verified against the 377 maps
(`RS2B0T-377-S9-1106/placements-cows.txt`). Bank tiles are shared city facts, not revision data.

## Fishing locations

The spots are the 377 placements of the "Fishing spot" npcs; the pack numbers them per mapsquare (`pack/npc.pack` `328:327=0_48_50_saltfish` to `953:952=0_48_48_newbiefishing`).
Placements: `maps/m48_50.jm2:7388,7391` (Draynor), `m44_53.jm2:5571-5578` (Catherby), `m42_55.jm2:6592-6596` (Seers fly fishing),
`m48_53.jm2:9010-9011` (Barbarian Village), `m45_49.jm2` (Musa Point), `m44_46.jm2` (Shilo Village river). Full decode in `RS2B0T-377-S9-1106/placements-fishspots.txt`.
Every spot sits inside its camp's box, so the 289 tiles and radii still hold.

## Item aliases

The generated nameCollisions groups decide which families still collide. The 289 edition also aliased the dragonhide family (1745/1065/1099/1135) and the unstrung bows (48-72);
the 377 content names every member distinctly, so those groups no longer exist.

- Unstrung bows carry their own "(u)" names (`all.obj`: `name=Oak longbow (u)` :743, `Maple longbow (u)` :803, `Magic shortbow (u)` :903), so they no longer collide with the strung bow. The 377 Oak longbow group pairs the signed variant (4236), which the generated `signed` word already separates.
- Dragonhide pieces carry per-color names (`Green d'hide body` :14517, `chaps` :13965, `vamb` :13444, `Green d-leather` :23393), so customers type the distinct names directly.
- Crystal key halves: both objs share name and desc and differ in model. The loop and tooth wording exists only in the 377 descs (`all.obj`: keyhalf1 :12500, keyhalf2 :12516); the group "Half of a key" pairs keyhalf1 985 with keyhalf2 987.
- Holy book pages: ids from `pack/obj.pack` (`3828:3827=holy_book_s_page1` to `3839:3838=holy_book_g_page4`); names are the content's own (`all.obj` `name=Torn page 1(s)` :46576 to :46840).
- Amulets: the 377 collision groups keep every strung and unstrung pair: Gold [1673,1692], Sapphire [1675,1694], Emerald [1677,1696,+6041 magic strung], Ruby [1679,1698], Diamond [1681,1700], Dragonstone ammy [1683,1702] (`all.obj` `name=Dragonstone ammy` :22547). The Emerald group has three members, which defeats the two-way worn and unworn split, so 1696 keeps the generated "Strung emerald amulet" label.
- Shorthand keys must be names the 377 content repeats. The dragonhide shorthand is gone with its groups, and Dragonstone retargets to "Dragonstone ammy".

## Mining locations and rocks

Rocks per camp are the 377 placements of the ids in `miningRocks.ts`: the classic 2090-2111 rocks plus the `rocks_97xx/111xxx/119xxx` series
(`pack/loc.pack`, `scripts/skill_mining/configs/mine.dbrow:12-183`); decode in `RS2B0T-377-S9-1106/placements-rocks.txt`.
Rimmington also carries the new-series field (clay 9713 at (2986,3239), copper 9708-9710 at (2976-2979,3245-3248), tin 9714/9716, iron 9717-9719, gold 9720/9722).

`mine.dbrow` names every rock per ore table: clay :12-20, copper :30-36, tin :46-54, iron :64-70, coal :80-86, gold :96-104, silver :114-120, mithril :130-133, adamantite :143-146, runite :156-159, blurite :171-172, gem :182-183.
`pack/loc.pack` maps each debugname to its id (`2091:2090=copperrock1`, `9709:9708=rocks_9708`). The new-series placements are the Rimmington, Crafting Guild and Barbarian Village fields (decoded from engine `data/pack/.cache/maps-server.zip`).
289 had only the classic block, so a camp's ore list can no longer assume two ids per ore.

Gas rocks: `mine.dbrow` lists each `macro_*rock` beside its ore: :32-33 copper, :48-49 tin, :66-67 iron, :82-83 coal, :98-99 gold, :119-120 silver, :132-133 mithril, :145-146 adamantite, :158-159 runite, :14-15 clay, :172 blurite, :183 gem.
`pack/loc.pack` assigns the 2119-2140 block (`2120:2119=macro_copperrock1` to `2141:2140=macro_gemrock`). 289 omitted 2140; the 377 gem table names it (`mine.dbrow:183`) and the maps place gemrocks (Shilo Village).

## Rune craft locations

Every `ruins` tile is the `exit_coord` of the rune's row in `scripts/skill_runecraft/configs/runecraft.dbrow` (air :13, mind :27, water :41, earth :55, fire :69, body :83, cosmic :101, chaos :116-124, nature :139, law :154, death :167),
cross-checked against the `<rune>temple_ruined` loc the maps place (`pack/loc.pack:2453-2463`). Two tiles changed from 289, where the 289 dbrow pointed cosmic and death into the altar realm:

- Cosmic: (3173,9501) to (2406,4380), the Zanaris ruins beside cosmictemple_ruined (`maps/m37_68.jm2:5816`, ruins SW (2407,4376)).
- Death: (3221,3218) to (1862,4639), east of deathtemple_ruined (`maps/m29_72.jm2:12379`, ruins SW (1859,4638)).

## Woodcutting ents

The macro_ent_* ids are `pack/npc.pack:1720-1751,1792-1793`: tree1-6 1719/1720/1721/1744/1747/1748, dead_tree1-11 1722-1732 plus dead_tree12 1745, dramen 1733, magic 1734, maple 1735,
willow1-3 1736-1738, oak 1739, yew 1740, evergreen1-3 1741-1743, achey 1746, hollow1-2 1749-1750, jungle_tree1-2 1791-1792. The 289 pack numbered them 444-452; pack ids depend on build history (pitfall 11).
The neighbours are not ents: crow 1751, favour_jimmy 1718, mm_waymottin_final_battle 1790, favour_tassie_slipcast 1793.

## Nav rows and camps changed in SC-i round 2

- Mage Arena: the cellar levers `magearena_lever_to_cellar` and `magearena_lever_from_cellar` teleport to 0_39_73_43_40 and 0_48_61_18_52 (`scripts/areas/area_mage_arena/scripts/mage_arena.rs2:1-22`). The 289 mystic-portal rows are gone: loc 2880 `magearena_scan` has no placement near 3105,3953 (`maps/m28_68.jm2:21871` holds its only placements).
- West Ardougne sewer: the pipe is entered from 2514,9739, the mud patch drops to 2518,9760, the manhole lands at 2529,3304 (`quest_elena.constant:23-26`).
- Dwarven trapdoor: loc 11867 `fai_dwarf_trapdoor_down` at 3019,3450, stood on from 3018,3450 (3019,3450 is blocked in the pack).
- Zanaris market gate: loc 2411 and npc 33 are declared (`pack/loc.pack:2412`, `pack/npc.pack:34`) but placed in no map file, so no gate exists to cross.
- Ardougne men camp: the Man at 2614,3318 is behind the locked door_2556 (`skill_thieving/scripts/doors/locked_door.rs2:83-106`); the camp stands at the Man at 2621,3293.
- Lumbridge start tile 3208,3220 is a sealed castle room in the 377 map; its only door is the Recipe for Disaster door (`rfd_feast_door.rs2:6-9`).
- Iron dragon loot: `npc_default_death` adds the `death_drop` param (`skill_combat/scripts/npc/npc_combat.rs2:3,90-95`); `iron_dragon` carries `param=death_drop,dragon_bones` (`dragons.npc`).
