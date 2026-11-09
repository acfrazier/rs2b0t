[Manual](../README.md) › [Running locally](../RUNNING.md) › [Run locally](run-locally.md)

# Revision-377 data and local gates

## Source checkouts

The public client branch contains 377-derived data, not the engine or content source.
These 377 sources are not published publicly. Request matching checkouts from the project
operator. Set `ENGINE_DIR` and `CONTENT_DIR` to their roots for local gates. Match both
commits to `data/manifest.json`.

## Regenerate data

Run this command from the client root. Use operator-provided local checkouts or authenticated
clone sources for the engine and content inputs. The helper clones fresh trees and checks
out its pinned commits.

```sh
GEN377_WORK=/path/to/377-data-work \
GEN377_ENGINE_REPO=/path/to/operator-provided-engine-source \
GEN377_CONTENT_REPO=/path/to/operator-provided-content-source \
bash tools/gen-377-data.sh
```

The helper defaults to Node 26.13.0 and Bun 1.4.4. Without an override, it rejects other
versions and records both in the manifest. Change a pin only for a deliberate toolchain
change. If `GEN377_NODE_MODULES` is unset, the helper runs `npm ci` and needs registry access.

After cutover, the helper writes generated files at their final repository paths. It updates
`data/manifest.json` and writes local `out/` assets.

## Run the local gate

Run the gate from the client root with matching 377 checkouts in `ENGINE_DIR` and
`CONTENT_DIR`. The engine must have its cache packed, but it does not need to run. Use
`tools/gen-377-data.sh` to build the pinned data, or run `tools/deploy-local.sh` against an
already packed engine to create missing local outputs, including the collision pack.

```sh
ENGINE_DIR=/path/to/377-engine CONTENT_DIR=/path/to/377-content bun run e2e -- --gates-only
```

The gate runs unit tests, typecheck, lint, generator drift checks, and manifest verification.
Unit-test input skips are reported but do not fail that gate by themselves. A drift gate
fails on command errors, stale output, a missing clean marker, or a skipped required local
input.

The current local-gate receipt exits 1. `doors drift` refuses Colony gate locs 14929 and
14931 because they have no `category.pack` id. The gate stays open until S8 route review
admits a loc. `nav transports drift` also failed because `out/collision.lcnav.gz` was absent.
Build that pack before rerunning. Keep the overall gate open for milestone M until the door
data passes review.

Hosted CI has no 377 engine or content checkout. It cannot replace this gate. See [build and
data plumbing](build-and-data.md) for the manifest and publication details.
