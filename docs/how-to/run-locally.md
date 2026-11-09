[Manual](../README.md) › [Running locally](../RUNNING.md) › Run locally

# Run rs2b0t locally

rs2b0t is a client with no server of its own. Local development needs a compatible game
engine and this client deployed into that engine's `public/` directory.

Production target is [rs2b2t](https://rs2b2t.com) only.

## Prerequisites

| Need | Why |
|---|---|
| [Bun](https://bun.sh) | builds and tests this repo |
| Node 24+ | the engine runs on it, as do the Electron and Playwright harnesses |

## Choose an engine

A build has one client revision. The client branch selects it. `TARGET` selects the network
and login-key behavior, not the client revision.

| Client branch | Engine and content branch | Revision |
|---|---|---:|
| `main` | `289` | 289 |
| `rev377` | `rs2-r377` | 377 |

Use matching client, engine, and content revisions. Keep engine and content as sibling
directories because Engine-TS reads content from `../content`.

### Start a revision-289 engine

1. Clone both repositories at revision 289:

   ```sh
   git clone https://github.com/LostCityRS/Engine-TS -b 289 --single-branch engine
   git clone https://github.com/LostCityRS/Content   -b 289 --single-branch content
   ```

2. Install and start:

   ```sh
   cd engine
   npm install
   npx tsx src/app.ts
   ```

3. Wait for `World ready`. First boot packs the cache and logs harmless
   `WARN missing model …` lines.

4. Check the web route with `curl -o /dev/null -w '%{http_code}\n' http://localhost:80/rs2.cgi`.
   Use the configured web port. The default is 80 on macOS and Windows, and 8888 on Linux.

See [ports](../reference/ports.md) for defaults, changing them, and why `World ready`
does not mean the game port is bound.

### Use the revision-377 engine

Use the client branch `rev377` with the matching 377 Engine-TS and Content checkouts on
`rs2-r377`. Use the engine and content commits recorded in `data/manifest.json`. Do not
pair a 289 client with the 377 engine or content.

## Regenerate revision-377 data

From the client root, set the engine and content variables to matching 377 repository paths
or clone URLs. Set `GEN377_WORK` to a disposable directory outside this checkout. The helper
pins the engine and content commits, regenerates the data, and verifies the manifest. After
cutover, the helper writes generated files at their final paths.

```sh
GEN377_WORK=/path/to/377-data-work \
GEN377_ENGINE_REPO=/path/to/engine \
GEN377_CONTENT_REPO=/path/to/content \
bash tools/gen-377-data.sh
```

Run the local-only gate with matching 377 engine and content checkouts in `ENGINE_DIR` and
`CONTENT_DIR`. It runs offline unit tests, typecheck, lint, generator `--check` commands, and
manifest verification. A command error, stale output, or skipped local input fails the gate.

```sh
ENGINE_DIR=/path/to/engine CONTENT_DIR=/path/to/content bun run e2e -- --gates-only
```

Hosted CI lacks these 377 inputs. It cannot replace this gate. See [build and data
plumbing](build-and-data.md).

## Deploy the client

1. `bun install`
2. Deploy:

   ```sh
   ./tools/deploy-local-key.sh /path/to/engine
   ```

For a preconfigured engine, run `ENGINE_DIR=/path/to/engine sh tools/deploy-local.sh` instead.

`tools/deploy-local.sh` requires `$ENGINE_DIR/public` to exist, then builds the stock
and bot clients, builds the collision pack from that engine's map data if
`out/collision.lcnav.gz` is absent, builds the worldmap basemap if its manifest is
absent, copies the bundles into `public/client/` and `public/bot/`, and installs
`bot.html` and `multibox.html`.

Both outputs live in the repo's `out/`, shared across the checkout.

## Run a bot

1. Open `http://localhost:<web>/bot.html`.
2. Register an account, a fresh engine has `website.registration` enabled.
3. Log in, open the panel, pick a script, set parameters, start it.

For several accounts in one tab open `multibox.html` and keep the tab visible; a
backgrounded tab is throttled to roughly 1 fps and every bot in it starves. For
unattended running use the [Electron shell](../../desktop/README.md).

`bun run b0t` runs the wall against production through a local reverse proxy instead of
a local engine.

## Test, lint and smoke

The test, lint, format and smoke commands, plus what `bunfig.toml` preloads: [test, lint and smoke](test-locally.md).

## Build and data plumbing

`bun run build:all-targets`, the manifest, the `data/377/` cutover and the skip groups: [build and data](build-and-data.md).

## See also

- [Ports and troubleshooting](../reference/ports.md)
- [Testing](../TESTING.md), unit tests and the live harnesses
- [Dev and deploy](../DEV.md), build targets, run modes, hosting
