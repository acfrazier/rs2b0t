[Manual](../README.md) › [Running locally](../RUNNING.md) › Run locally

# Run rs2b0t locally

rs2b0t is a client with no server of its own. Local development needs a compatible game
engine and this client deployed into that engine's `public/` directory.

Production target is [rs2b2t](https://rs2b2t.com) only.

## Prerequisites

| Need | Why |
|---|---|
| [Bun 1.4.4](https://bun.sh) | The CI workflow pins this version. |
| Node 24+ | Runs the engine, Electron, and Playwright harnesses. |

## Choose an engine

A build has one client revision. The client branch selects it. `TARGET` selects the network
and login-key behavior, not the client revision.

| Client branch | Matching engine and content | Revision |
|---|---|---:|
| `main` | Public LostCityRS Engine-TS and Content checkouts on branch `289`. | 289 |
| `rev377` | Not published publicly; use matching checkouts supplied by the project operator. | 377 |

Keep engine and content as sibling directories because Engine-TS reads content from `../content`.

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

The public client contains 377-derived data, but it does not publish the 377 engine or
content source. Obtain matching 377 checkouts from the project operator. Set `ENGINE_DIR`
and `CONTENT_DIR` to their roots for local gates. Match their commits to `data/manifest.json`.
Do not pair a 289 client with 377 inputs.

## Regenerate revision-377 data

From the client root, set `GEN377_ENGINE_REPO` and `GEN377_CONTENT_REPO` to operator-provided
local checkouts or authenticated clone sources. The helper pins engine and content commits.
It defaults to Node 26.13.0 and Bun 1.4.4. See [revision-377 data and local gates](revision-377-data.md)
for the regeneration command, setup, and current gate status.

### Run the local 377 gate

Set `ENGINE_DIR` and `CONTENT_DIR` to matching 377 checkouts with a packed cache. The gate
does not start a game server. Unit-test input skips are reported but do not fail the
unit-test gate alone. Drift gates fail on command errors, stale output, a missing clean
marker, or a skipped required local input.

The current receipt remains open for milestone M. See the linked page for its failures and
the collision-pack prerequisite.

Run from the client root:

```sh
ENGINE_DIR=/path/to/377-engine CONTENT_DIR=/path/to/377-content bun run e2e -- --gates-only
```

Hosted CI has no 377 engine or content inputs. It cannot replace this gate. See
[build and data plumbing](build-and-data.md).

## Deploy the client

1. `bun install`
2. Deploy:

   ```sh
   ./tools/deploy-local-key.sh /path/to/engine
   ```

To set the engine's public key values yourself, run `LOCAL_RSAE=<exponent> LOCAL_RSAN=<modulus> ENGINE_DIR=/path/to/engine sh tools/deploy-local.sh`. See [Local login key](../reference/build-targets.md#local-login-key) for how to derive both values.

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

## Maintainer cheats

On local test engines with `staffModLevel` 4, use `::tele 0,mx,mz,lx,lz`,
`::~maxme`, and `::give <objname> <count>`. Use `cert_<objname>` for notes.
The level-up dialogs raised by `::~maxme` swallow the next typed command. Clear
those dialogs before you enter another command.

## See also

- [Ports and troubleshooting](../reference/ports.md)
- [Testing](../TESTING.md), unit tests and the live harnesses
- [Dev and deploy](../DEV.md), build targets, run modes, hosting
