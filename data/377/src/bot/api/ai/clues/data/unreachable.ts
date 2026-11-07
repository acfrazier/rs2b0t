// Why: these are gaps between the clue database (generated from the pinned 377 content a15d0faa8) and the
// baked 377 nav pack/content state; the solver abandons cleanly and the pending fix makes the clue work with no solver edit.
// Why: not consulted by the solver, so a fix takes effect on its own.
// Why: the audit allowlists these instead of counting them as findings, and the live harnesses use them to tell a known gap apart from a regression.
// Why: the section markers below say what kind of row it is; CONTENT DEFECT rows carry the file:line evidence of both sides.
// @see docs/reference/clues-gates.md#clues-the-pack-cannot-reach

/** Clue destinations the 377 pack/content cannot serve yet, each with its stated gap. */
export const PACK_UNREACHABLE: Record<number, string> = {
    // CONTENT DEFECT: stale trail_coord param, fix pending (FR content unit). The obj's trail_coord points
    // at the 289-era tile while the content's own handler script, the 377 map placement and the
    // treasure_trail_destination (10627) marker agree on the placed tile. The solver walks the stale tile and
    // abandons; the regeneration on fixed content removes the row.
    2678: 'content defect: stale trail_coord param, fix pending (FR content unit) — obj `1_50_50_28_16` (all.obj:30619) vs the crate the script checks `1_50_50_28_12` (crates.rs2:4), placed at (3228,3212,1) with marker 10627 (maps/m50_50.jm2)',
    2679: 'content defect: stale trail_coord param, fix pending (FR content unit) — obj `0_50_50_48_46` (all.obj:30635) vs the boxes the script checks `0_50_50_45_45` (crates.rs2:66), placed at (3245,3245,0) with marker 10627 (maps/m50_50.jm2)',
    2694: 'content defect: stale trail_coord param, fix pending (FR content unit) — obj `0_46_51_25_46` (all.obj:30875) vs the drawers the script checks `0_46_51_25_47` (drawers.rs2:47), placed at (2969,3311,0) with marker 10627 (maps/m46_51.jm2)',
    2711: 'content defect: stale trail_coord param, fix pending (FR content unit) — obj `0_40_51_49_40` (all.obj:31147) vs the crate the script checks `1_40_51_52_40` (crates.rs2:25), placed at (2612,3304,1) (maps/m40_51.jm2)',

    // NAV: destinations the baked 377 pack cannot route to from the audit's bank starts (expansion budget
    // exhausted, so the destinations sit in a component the banks cannot reach). The 377 doors bake lost
    // 335 of the 289 crossings and gained 222; each row names the crossing(s) the route needs. S8's route
    // corpus or a P4b derivation fix restores them; baking the crossing makes the clue work with no solver edit.
    2773: 'nav gap: hard riddle001 chest at (3219,9617,0) is unreachable from both audit banks; the 377 doors.json lost the wilderness-underground crossings the route needs (Gate locs 1557/1558 at (3151,9565-9566) and the Sturdy door 2411 at (3233,9554)/(3238,9558), plus the ladders 1747/1746 at (3171,9579) from the 289 doors/stairEdges; derive-doors missed them as Open locs without a 377 category)',
    2790: 'nav gap: hard riddle011 dig at (3161,9905,0) is unreachable from both audit banks; no crossing is lost at the dig itself, so the break is upstream in the same lost set (the underground gates/ladders listed under 2773); the S8 route corpus decides which edge to re-bake',
    2853: 'nav gap: medium anagram008 (Gnome ball referee) anchor (2384,3488,0) sits behind the gnome ball field gate, which the 377 doors.json lost: loc 2394 gate_gnomeball_game ("Gate", op1 Open) at (2383,3488) has no 377 category, so the category join dropped it (the 289 pack derived it); deriving Open locs without a category restores it'
};
