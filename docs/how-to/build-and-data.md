[Manual](../README.md) › [Running locally](../RUNNING.md) › Build and data plumbing

# Build and data plumbing

## Build every target

`bun run build:all-targets` builds every browser and worker entry (`client`, `mapview`,
`ondemandworker`, `botclient`, `multibox`, `navworker`) for the `local` and `prod` targets,
with both strict flags baked in and one build identity across the two bundlers. CI runs it,
and `test/tools/bundleDefines.test.ts` then requires every output.

`TARGET=prod` needs the game server's public pair, `PROD_RSAE` and `PROD_RSAN`. A hosted
runner has neither, so it passes `--dummy-rsa`: the artifact bakes a fixed public test pair,
`out/version.json` reads `"rsa": "dummy"`, and `tools/pack-rs2b0t.sh` and
`deployIsolatedClient` refuse to deploy it. A dummy compile proves the target builds; it
proves nothing about login.

```sh
bun run build:all-targets -- --dummy-rsa   # compile check, nothing to deploy
bun run build:all-targets                  # deploy build, needs PROD_RSAE/PROD_RSAN
bun run build:all-targets -- --plan        # print the matrix without building
```

## Data manifest, staging and the cutover

`data/manifest.json` records the engine and content commits the data came from, the sha256
of the engine's `data/pack/client/{config,interface}` archives, the generator script hashes,
and every artifact's hash, kind and qualification. Three readers:

- `bun tools/lib/manifest.ts verify`: every listed artifact and generator still has its
  recorded hash. Hosted CI runs it; a generator edited without regenerating fails it.
- `bun tools/lib/manifest.ts archives <engine>`: the engine serving a run has the archives
  the data was derived from. `tools/pack-rs2b0t.sh` and `deployIsolatedClient` run the same
  check and refuse a mismatch.
- `bun tools/cutover-377.ts`: moves `data/377/<repo path>` onto its repo path, deletes the
  staging tree and the 289 recordings, and rewrites the manifest. It refuses an unlisted
  staged file or a hash mismatch before moving anything. It has run on this branch: the
  manifest reads `cutover: true` and `data/377/` no longer exists.

For the 377 navigation bake, `tools/gen-377-data.sh` stages door, stair and transport
JSONs plus the door-category and stair-price inputs under `data/377/`. The compressed
collision pack is built in the run's private work directory and recorded as an `out`
artifact at `out/collision.lcnav.gz` with its temporary source in `data/377/out/`; the
cutover validates and moves that source. `build-collision.ts` defaults to
`out/collision.lcnav` for every revision, and deploy/pack callers name that path explicitly,
so a revision-specific build cannot overwrite a staged pack. After the cutover the manifest reads
`cutover: true` and the same command regenerates the committed data in place: generators write at
their repo paths, the manifest rows land at their final paths, and `manifest.ts verify` passes.

For the full stair/ladder composition, source-of-truth rules, and `--check` behavior, see the
[revision-377 stair and ladder bake](../reference/nav-pack.md#revision-377-stair-and-ladder-bake).

### Generator output and staging

`tools/lib/genout.ts` resolves where a data generator writes. `--stage <dir>` redirects
every generated module to `<dir>/<repo path>`, and the matching `--check` follows the same
resolution, so a staged check compares against the staged file. Without it a generator
writes at its repo path. That indirection lets preparation slices land green on the 289
branch while producing 377 artifacts, which cannot sit at their final paths before the
cutover. `REVISION` selects the revision the generators decode for, defaulting to the
committed `CLIENT_VERSION`; a generator branches on it only where the 289 and 377 pack
formats differ.

### The manifest writer

`tools/gen-377-manifest.ts` updates `data/manifest.json` for a staged 377 data build: engine
and content provenance, toolchain, generator script hashes, and artifact hashes. Scalar
fields and the listed rows are replaced; artifact rows the run does not name (another
slice's) are preserved untouched. A staged `out` row uses its final `out/` path and a
`stagedPath` source under `data/377/`; artifacts are sorted by path.

```sh
bun tools/gen-377-manifest.ts --revision 377 \
  --engine-dir <dir> --engine-commit <sha40> --content-commit <sha40> \
  --node <version> --bun <version> \
  [--generator <repo path>]… [--artifact <repo path>=<kind>[:<qualification>]]… \
  [--out-dir <dir>] [--seed-manifest <previous generated manifest>]
```

A staged artifact is named by its `data/377/<repo path>` source; an `out` artifact there is
recorded at its post-cutover `out/` path. `--seed-manifest` supplies the previous generated
manifest only when the current file cannot be parsed, for merge-conflict regeneration.

### Component ids

`tools/gen-ifids.ts` writes `ifIds.ts` under the generated `src/bot/data/` tree: the
component id for every pack name in `tools/ifids.list`, resolved from the content
checkout's `pack/interface.pack`. The adapter and `src/bot/api` address components by
number, and those numbers change per revision, while the Fairy Ring-authored pack names
do not; the hand-maintained list carries names and the generator resolves them per
revision.

```sh
bun tools/gen-ifids.ts [--check] [--stage <dir>]
```

`CONTENT_DIR` names the content checkout whose `pack/interface.pack` is read (default
`~/code/rs2b2t-content`), and `REVISION` sets the revision label in the generated header
comment (default `CLIENT_VERSION`).

Before the cutover `data/377/` was tracked but inert: `bunfig.toml` roots test discovery at
`test/`, `tsconfig.json` excludes the tree and eslint ignores it.
`test/repo/stagingInert.test.ts` keeps a throwing test and an unresolvable import there, so
removing one of the three exclusions fails the suite. After it, the manifest reads
`cutover: true` and `test/repo/publicBoundary.test.ts` requires the tree to be absent.

### Deploying against a 377 engine

A 377 engine serves `rs2.html` and no `bot.html`. `deployIsolatedClient` takes the page it
copies from the engine's `public/bot.html`; with `--seed-html` on the script's command line
(or `{ seedHtml: true }`) it falls back to this repository's `public-bot/bot.html`. The
run's own `bot-<tag>.html` is the only file written to the engine's `public/`.

### Tests the 377 data cannot satisfy

A test whose scenario 377 does not contain is never edited to a 377 expectation without a
source line. `test/lib/skip377.ts` skips it by name, prints a `SKIP: <file>: <reason>` line
for the job summary, and the reason names what the 377 tree lacks. Executor tests keyed on
clue ids the 377 trail does not sell inject the 289 rows from `test/lib/legacyClueRows.ts`
for the length of the file and remove them again; an id the 377 cluedb carries is never
overwritten.

## What a run did not check

A test that needs a local input prints one `SKIP: <file>: <reason>` line from
`test/lib/skipUnless.ts`, in five input-keyed groups: `ENGINE_DIR` (absent or on another
revision), `CONTENT_DIR`, `RS2B0T_CACHE_BUNDLE`, `out/collision.lcnav.gz`, and the prod key
pair, which never skips because the dummy compile covers it. CI copies those lines into its
job summary.

A content- or engine-backed `--check` is a local, mandatory gate: `driftVerdict` fails a
receipt whose skip list names any of the first four groups, so a green hosted run is never a
substitute for the local `bun run e2e -- --gates-only` receipt.

## Publication guard

`test/repo/publicBoundary.test.ts` scans the Git index for absolute home-directory paths
(`/Users`, `/Volumes`), PEM armour and private-key material, `password` query values, and
tracked `.pem`/`.rs2`/`.loc`/`.npc`/`.obj`/`.inv`/`.pack` files. Upstream `main` carries 14
such matches; they are frozen in `test/repo/publicBoundary.allow.json` by path, rule, exact
text and reason. Any other match fails, and an entry that stops matching fails too. The list
grows only at an upstream merge, for lines upstream carries.
