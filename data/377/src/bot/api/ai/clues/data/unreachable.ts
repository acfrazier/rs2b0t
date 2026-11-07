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

    // NAV: destinations the baked 377 pack cannot route to from the audit's bank starts; each row names the
    // missing crossing for an S8 live bake or a P4b follow-up.
    2773: '@nav-diagnosis: hard riddle001 search chest — pending the nav probe receipt',
    2790: '@nav-diagnosis: hard riddle011 dig — pending the nav probe receipt',
    2853: '@nav-diagnosis: medium anagram008 (Gnome ball referee) — pending the nav probe receipt'
};
