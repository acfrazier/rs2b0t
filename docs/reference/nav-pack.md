[Manual](../README.md) › [World-walking](../NAV.md) › Collision pack

# The collision pack

The client only knows collision for the scene it has loaded. World-scale pathfinding
needs the map, so collision is **baked ahead of time** from an engine's data by
[`tools/nav/build-collision.ts`](../../tools/nav/build-collision.ts) into
`out/collision.lcnav.gz`.

The pack is built from *the engine you are deploying into*
([`tools/deploy-local.sh`](../../tools/deploy-local.sh) does it on first run), so it
matches that server's map. The **map tile picker** uses the same pack for its
walkable overlay (and a separately baked worldmap basemap for decoration), see
[Map tile picker](../MAP-PICKER.md).

Alongside the raw collision the pack carries a graph of traversal edges that plain
collision cannot express:

| Data | Source | What it adds |
|---|---|---|
| [`doors.json`](../../src/bot/event/webwalk/data/doors.json) | [`tools/nav/derive-doors.ts`](../../tools/nav/derive-doors.ts) | openable barriers, and which tiles they join |
| [`stairEdges.json`](../../src/bot/event/webwalk/data/stairEdges.json) | [`tools/nav/derive-transports.sh`](../../tools/nav/derive-transports.sh): `derive-stairs.ts`, then `derive-ladders.py` and `enrich-transports.py` | stairs and ladders, so paths can change level |
| [`transports.json`](../../src/bot/event/webwalk/data/transports.json) | curated | edges the derivations cannot infer |
| [`travelCatalog.ts`](../../src/bot/event/webwalk/travelCatalog.ts) | content constants | 2004 travel (spirit/glider/Entrana/cart/essence/levers/agi) merged at graph load |
| [`specialRequires.ts`](../../src/bot/event/webwalk/specialRequires.ts) | content scripts | plan-time skill/coin gates on doors and transport from-tiles |
| [`teleportCatalog.ts`](../../src/bot/event/webwalk/teleportCatalog.ts) | content / kit | spell + jewellery tele edges injected into A* by default |

Revision 377 manifests pin the gzip artifact and also the SHA-256 of its
decompressed nav bytes. The raw hash records graph identity independently of gzip
metadata; deployment checks both digests before writing its isolated client files.
The door bake receipt lists every policy-refused `Open` loc type and a separate
uncategorized subset. The Gnomeball gate's generic loc type remains refused; only
the content-confirmed placement at `(2383,3488,0)` is added as a curated route edge.
There is a **single** door/transport/travelCatalog graph and a **single** executor
(`WalkExecutor` + `exec/`). Live walks snapshot WorldState so skill/quest/coin gates
fail closed when the player cannot use them. Offline / no-state path finds **fail open**
on requires (pack-tool parity, ships and skill doors still expand).

Multi-level routing is therefore a **data** property, not an algorithm one: the
executor already knows how to climb, and gains a new route the moment an edge for it
exists in the pack.

## Revision 377 stair and ladder bake

The stair and transport files are composed. `tools/nav/derive-transports.sh` runs
`derive-stairs.ts`, `derive-ladders.py`, `enrich-transports.py`, then
`fix-stair-approaches.ts`; together they rewrite `stairEdges.json` and `transports.json`. A
stairs-only run does not reproduce the committed files. `sh tools/nav/derive-transports.sh
--check` reruns all four stages in a scratch root from the committed `transports.json` and
compares both outputs. `derive-stairs.ts --check` runs the same full check; the other
individual stage checks only verify their own output.

For revision 377, `stairs.rs2` and `ladders.rs2` destinations are authoritative. The parser
retains each script handler and source coordinate until it resolves the map placement; a
revision-specific loc name can match only when no more-specific movement handler exists.
Coordinate-relative teleports use the selected approach tile, explicit destinations remain
exact, reverse edges are not synthesized, and stair actions without a content movement
handler stay disabled. The first approach search is collision-derived and extends one tile
beyond the blocked footprint to cover rotated multi-tile stairs. After enrichment, the final
pass resolves each exact map placement and loc config, including rotated dimensions and
`forceapproach`, and preserves the current stand when it is walkable and accepted by revision
377's `ReachStrategy` with a walkable landing (content portals may stand on the loc tile).
For content-authored transport rows, a missing adjacent correction leaves the row active for
the independent engine census rather than inventing an unusable-content reason; generated
stair edges keep their existing disable mechanism. Coordinate-relative landings are
recomputed from corrected approaches.

The revision-377 reach census builds an isolated engine collision map from `maps-server.zip`
and calls the engine's `ReachStrategy.reached` for every active stair/dungeon edge; each
rejection reports its loc ID, placement, approach, and reason. A companion landing census
compares every stair edge and the 30 previously rejected transport rows with content
movement destinations, including open-loc variants and queued teleports. The Shantay Pass is
branch-sensitive: the south-side `coord+3` action and north-side queued teleport/`coord-3`
action keep distinct approach and landing tiles.

So is *same-level* routing, wherever the link is an Agility shortcut. `derive-doors`
only sees doors, so a balance log or a climbable outcrop leaves two regions looking
disconnected however open they are in game. Southern Karamja was the extreme case:
the 6,193-tile jungle holding the Ah Za Rhoon mound and Rashiliyia's tomb, and all of
Cairn Isle, were unreachable from anywhere until four `kind: "dungeon"` edges, a
wooden log and a set of climbing rocks, were curated in. When a quest reports a stand
tile as `pathable-from=[nothing]`, look for the shortcut before touching the walker.

A pack-less checkout is a silent failure mode. The navigator has nothing to search,
so every route fails rather than erroring loudly.

## See also

- [World-walking](../NAV.md)
