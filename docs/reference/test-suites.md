[Manual](../README.md) › [Testing](../TESTING.md) › Suites

# Test suites

```sh
bun test                 # everything
bun test test/event/webwalk        # one directory
bun test test/docs       # the manual's own integrity
```

`test/` mirrors `src/bot/`, so a test lives at the path its subject does.

| Directory | Covers |
|---|---|
| [`test/scripts/`](../../test/scripts/) | per-bot decision logic |
| [`test/api/ai/quests/`](../../test/api/ai/quests/) | quest `decide()` branches, engine, primitives |
| [`test/api/`](../../test/api/) | the scripting surface, mirroring `src/bot/api/` |
| [`test/api/ai/clues/`](../../test/api/ai/clues/) | clue db, executor, solvers |
| [`test/event/webwalk/`](../../test/event/webwalk/) | path math, reach, walk ladder, pathfinder goals |
| [`test/multibox/`](../../test/multibox/) | slots, vault, login coordination |
| [`test/runtime/`](../../test/runtime/) | scheduler, registry, settings, diagnostics |
| [`test/tools/`](../../test/tools/) | tooling libraries, including doc links |
| [`test/panel/`](../../test/panel/) | panel and overlay |
| [`test/adapter/`](../../test/adapter/) · [`test/client/`](../../test/client/) · [`test/docs/`](../../test/docs/) | targeted |

### Collision pack (nav)

`out/collision.lcnav.gz` is gitignored. Pack-backed nav tests use
`test.skipIf(!HAS_COLLISION_PACK)` so a fresh checkout reports **skipped** coverage,
not silent green passes (#341). Build the pack via
[`tools/nav/build-collision.ts`](../../tools/nav/build-collision.ts) or
[`tools/deploy-local.sh`](../../tools/deploy-local.sh), then re-run `bun test test/event/webwalk`.

### Export census

`bun run audit:exports` (`tools/audit-exports.ts`) builds one TypeScript program over
`src/`, `test/`, `e2e/` and `tools/`, including `.js`/`.mjs`/`.cjs` and `#/` specifiers,
named and star re-export conduits, local/default aliases and transitive heritage. It
writes `out/audit-exports/integrated.json` from those raw rows. G0 is zero references of
every measured kind; a same-file use is not dead; a G0 count is a candidate list, not a
CI failure. Member status `published` is the npm barrel (`index.js` / `index.d.ts`) and
docs-held surfaces. Members of extra `__rs2b0t` roots are `publication-held`. Both stay
protected from removal. Fixtures live in `test/tools/audit-exports.test.ts`.

## See also

- [Why this is testable](../decisions/testability.md)
- [Write a harness](../how-to/write-a-harness.md)
