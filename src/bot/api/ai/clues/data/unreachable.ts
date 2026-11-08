// Why: these destinations are outside the ordinary 377 navigation graph; the audit keeps explicit exceptions until graph edges cover them.
// Why: this map is not consulted by the runtime solver; it distinguishes known offline reachability gaps from regressions.
// @see docs/reference/clues-gates.md#clues-the-pack-cannot-reach

/** Clue destinations the 377 pack/content cannot serve yet, each with its stated gap. */
export const PACK_UNREACHABLE: Record<number, string> = {
    // NAV: the baked ordinary graph cannot cross the Regicide seams; the solver's Tirannwn helper handles these after the quest gate opens.
    3560: 'nav gap: hard sextant031 Isafdar dig at (2209,3161,0) is beyond the ordinary graph’s Regicide seams; tirannwnTravel.ts handles the route after Regicide is complete',
    3562: 'nav gap: hard sextant032 Isafdar dig at (2181,3206,0) is beyond the ordinary graph’s Regicide seams; tirannwnTravel.ts handles the route after Regicide is complete',
    3564: 'nav gap: Lord Iorwerth in the elf camp is beyond the ordinary graph’s Regicide seams; tirannwnTravel.ts handles the route after Regicide is complete'
};
