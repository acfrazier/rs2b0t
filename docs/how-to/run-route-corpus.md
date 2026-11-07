[Manual](../README.md) › [World-walking](../NAV.md) › Route corpus

# Route corpus and HARD stress

The script-route corpus ranks hard OD pairs for live regression walks. Artifacts
are **generated and gitignored**, regenerate before `HARD=1` live runs.

| Artifact | Role |
|---|---|
| `tools/nav/script-routes.generated.json` | Full successful probe set after endpoint + corridor dedupe (gitignored) |
| `tools/nav/script-routes.hardest.json` | Top-N by difficulty for live HARD walks (gitignored) |

**Generate (requires collision pack):**

```bash
bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts --write --hardest=25
# optional: --no-tele for pure-walk ranking; tele ranking is default (full runes)
```

Probe WorldState is a **maxed members account** (skills 99 for guild doors, transport
quests complete, runes + charged jewellery). Magic-only was insufficient: Fishing
Guild doors need fishing 68, so BANK_* → Fishing Guild exhausted the expansion
budget instead of opening the guild doors.

**Dedupe stages** (see `tools/nav/script-route-corpus.ts`):

1. **Endpoint near-dedupe** (`dedupePaths`), drop generator twins with nearly the same directed from→to.
2. **Journey fingerprint** (`pathCorridorSignature` + `dedupeByCorridor`),
   fingerprint is **end map-square + hop sequence** only (not start). Pure-walks
   into the same region collapse (one *→Rellekka walk); tele vs walk stay
   separate. Keep the highest-difficulty row per signature.
3. **HARD top-N** (`rankHardest`), score cost / expansions / hop count for the live sample list.

## Revision 377 offline qualification

Before cutover, set `REVISION=377` and `NAV_DATA_ROOT=data/377` for the nav generators.
They read the reviewed door and stair rules from that root.
`gen-377-data.sh` preserves existing staged rules instead of replacing them with the active revision's rules.
Never edit generated door, stair or transport rows.

The castle trapdoor uses `Open` to descend directly.
Its rule follows `scripts/general_use/scripts/trapdoors.rs2:31-35`, with zero extra delay ticks.
The Haunted Mine reward doors remain refused because `hm_reward_door.rs2:25-35` requires a key on entry.
Manhole enrichment uses the closed/open pair from `scripts/general_use/scripts/manholes.rs2:1-10`.
The generated edge keeps the closed loc ID and records the open interaction ID.

After a scratch cutover, run `bun test test/event/webwalk/routeCorpus377.test.ts` with the 377 collision pack.
The seven required routes use the production `PathFinder`, not edge-presence checks alone.
Remove a required edge and rerun its route test to check that the assertion detects disconnection.

## See also

- [Script travel OD](script-travel-od.md)
- [World-walking](../NAV.md)
