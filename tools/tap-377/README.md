# Development session capture

This directory contains the development-only game/OnDemand tap. Its Playwright capture driver is in `e2e/tap-377/`, which keeps browser automation inside the repository's e2e boundary. Nothing here is imported by the browser client. `test/tools/noTapInBundles.test.ts` checks the product source and all built browser and worker bundles, including source maps.

## Safety and format

The tap binds to loopback and requires an explicit engine directory and origin. It reads the engine login key in place. Login requests, RSA blocks, credentials, seeds, and the machine identifier are never recording fields. Independent ISAAC instances decrypt the two game directions after an accepted login. The OnDemand connection is classified separately and is never ISAAC-decoded.

A JSONL file starts with a versioned header: revision, engine/content/client commits, disposable account prefix, and hashes of the nine HTTP archive responses. Each segment contains the accepted login replies, plaintext game frames, checkpoints, and a clean segment end. Frames include the opcode and any variable-length prefix. `tick` counts inbound `PLAYER_INFO` packets; each direction also has its own ordinal. A checkpoint names the exact number of inbound packets the browser has consumed, not the number the network has received.

The cache bundle is separate from the public recording. It contains the nine archive responses and the compressed OnDemand files requested during capture. `test/io/recordings/index.json` pins both the recording and the cache bundle by SHA-256. Keep cache bundles and receipts in the approved evidence directory; never add the engine key or raw content source to Git.

Archive URLs retain the client's signed CRC suffix, including negative values; the tap forwards them unchanged. The OnDemand factory seam retains one worker per loader until `stop()`, so initialization and subsequent requests reach the same worker. Synthetic tests cover both contracts.

## Capture driver

Run the reference scenario with the current 289 rs2b0t client first. Prove that recording through the production replay runtime before capturing any 377 scenario. The 377 scenarios use the existing harness page without changing its client or harness bundle.

```sh
bun e2e/tap-377/capture-session.ts \
  --engine-dir "$ENGINE_DIR" --origin "$ENGINE_ORIGIN" \
  --scenario reference --out "$EVIDENCE_DIR/reference" \
  --account-prefix "$ACCOUNT_PREFIX" \
  --client-commit "$CLIENT_COMMIT" --content-commit "$CONTENT_COMMIT" \
  --quiet-lock "$QUIET_LOCK"
```

The output directory must not exist. The driver creates a fresh disposable account under the supplied prefix and keeps its secret in memory. The reference browser is built inside the output directory and served by the tap; no engine public files are changed. Headed Chrome is the default. `--headless` is explicit.

For revision 377, select `tutorial`, `mainland`, or `instance`. The latter two require `--harness-lib` naming the operator-approved account helper module. Its `mainlandAccount` prepares only the fixture account. The receipt labels every seed operation; no seed is credited as the interaction being proved. No scenario starts, stops, repacks, or edits an engine.

The driver asserts a built scene and a stable route head for five server ticks before each checkpoint. It rejects packet-handler failures and players outside the disposable prefix. It asserts movement, interface results, count-dialog withdrawal, both non-adjacent bank rearrangement modes, instanced scene construction, clean logout, and a same-client relogin. Screenshots and a structured receipt accompany each attempt. A failed attempt is retained, not silently promoted to a recording.

## Validation boundary

`check-recording` validates membership and frame lengths against an explicit revision's descriptors, session ordering, checkpoint counts, and publication fields. Revision 377 descriptors must match the committed P1 fixture. Required scenario opcodes are separate capture acceptance checks: a well-formed recording alone does not prove that the intended actions occurred.

Check a committed recording and its index entry with:

```sh
bun tools/tap-377/check-recording.ts \
  --recording test/io/recordings/289/reference.jsonl \
  --cache "$CACHE_BUNDLE" --engine "$ENGINE_DIR" \
  --index test/io/recordings/index.json
```

The recording path in the index is relative to the index directory. For a 377 recording, omit `--engine` to select the committed P1 descriptors. A cache-backed replay of the current client revision runs with:

```sh
ENGINE_DIR="$ENGINE_DIR" RS2B0T_CACHE_BUNDLE="$CACHE_BUNDLE" \
  bun test test/io/replay.test.ts
```

Before the client cutover this selects the 289 recording. The 377 captures are checked for wire validity now and replay through the 377 production client after cutover.

Replay uses the production client frame and cache loaders. It does not exercise real network sockets, the OnDemand wire parser, or rendering. The live capture covers the socket and OnDemand paths; renderer qualification remains a live-client check. Hosted CI can run the synthetic failures without a cache bundle and must state when a real cache-backed recording is skipped.
