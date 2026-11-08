# Development session capture

This directory contains the development-only game/OnDemand tap. Its Playwright capture driver is in `e2e/tap-377/`, which keeps browser automation inside the repository's e2e boundary. Nothing here is imported by the browser client. `test/tools/noTapInBundles.test.ts` checks the product source and all built browser and worker bundles, including source maps.

## Safety and format

The tap binds to loopback and requires an explicit engine directory and origin. It reads the engine login key in place. Login requests, RSA blocks, credentials, seeds, and the machine identifier are never recording fields. Independent ISAAC instances decrypt the two game directions after an accepted login. The OnDemand connection is classified separately and is never ISAAC-decoded.

The key reader accepts unencrypted two-prime RSA in PKCS#1 or version-0 PKCS#8. PKCS#8 must declare the RSA encryption algorithm; other algorithms and encrypted keys are rejected. The same integer decoder handles the large public exponent used by older engines.

A JSONL file starts with a versioned header: revision, engine/content/client commits, disposable account prefix, and hashes of the nine HTTP archive responses. Each segment contains the accepted login replies, plaintext game frames, checkpoints, and a clean segment end. Reply `2` includes two metadata bytes. Reply `15` is accepted only for reconnects and has no metadata bytes. Frames include the opcode and any variable-length prefix. `tick` counts inbound `PLAYER_INFO` packets. Each direction also has its own ordinal. A checkpoint names the exact inbound packet count consumed by the browser, not the count received by the network.

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

The output directory must not exist. The driver creates a fresh disposable account under the supplied prefix and keeps its secret in memory. The reference browser uses a temporary build directory outside the evidence directory. Capture removes that directory on success or failure. No engine public files are changed. Headed Chrome is the default. `--headless` is explicit.

For revision 377, select `tutorial`, `mainland`, or `instance`. The latter two require `--harness-lib` naming the operator-approved account helper module. Its `mainlandAccount` prepares only the fixture account. The receipt labels every seed operation; no seed is credited as the interaction being proved. Teleport seeds use the shared engine-coordinate encoder and must reach their exact target tile. No scenario starts, stops, repacks, or edits an engine.

The driver asserts a built scene and a stable route head for five server ticks before each checkpoint. It rejects packet-handler failures and players outside the disposable prefix. It asserts movement, interface results, count-dialog withdrawal, both non-adjacent bank rearrangement modes, instanced scene construction, clean logout, and a same-client relogin. Before finalization it also waits for the tap's outstanding cache requests and partial wire buffers to drain; the client's urgent-request count alone does not include background prefetch. Successful checkpoints have screenshots. Failure receipts retain allowlisted state and packet byte counts, not arbitrary packet dumps or exception text. A failed attempt is retained, not silently promoted to a recording.

The foreign-player check remains active after the last checkpoint, during cache drain, and around finalization. Key parsing never prints private RSA parameters. Missing engine and replay-cache files produce path-free errors.

Bank drags wait for the client to observe the hovered source slot before pressing the mouse. Both modes use occupied, non-adjacent slots. Each drag is checked again after closing and reopening the bank, so the client's optimistic reorder alone cannot pass the capture.

## Validation boundary

`check-recording` validates membership and frame lengths against an explicit revision's descriptors, session ordering, checkpoint counts, and publication fields. Revision 377 descriptors must match the committed P1 fixture. Required scenario opcodes are separate capture acceptance checks: a well-formed recording alone does not prove that the intended actions occurred.

The strict client consumes the fixed `HINT_ARROW` padding for NPC, player, and clear variants. The production-handler regression checks all six bytes and the decoded target values; it does not bypass the packet-consumption guard.

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

The runtime loads every indexed recording for `CLIENT_VERSION`. Before cutover, this selects the 289 reference recording. After cutover, this selects every committed 377 recording, including `377/l1.jsonl`, captured by the rs2b0t L1 cell (`e2e/rs2b0t-377-l1.ts`) from rs2b0t's own client. Set `RS2B0T_CACHE_BUNDLE` to a directory containing `<cacheSha256>.json` for each required bundle. The existing single-file form remains valid when all selected recordings use that file's hash. Missing or mismatched bundles fail the test. Hosted CI checks every committed 377 recording against the index and P1 descriptors without any cache bundle.

Each checkpoint requires observed locations on the active level and non-default collision flags inside the player's eight-tile zone. Allocated maps and default boundary flags do not satisfy this check. The instance flag comes directly from the client, not from an absent reader field. Cache-free tests reject empty worlds, reset collision maps, wrong-level flags, and wrong-zone flags.

The runtime checks the adapter's packet-listener sequence for every notifying packet. `LOGOUT` is a terminal handler: it returns false, so the adapter does not notify it. Replay requires that this packet runs production logout. A new login must reset the same client's session state. A reconnect uses production `lostCon`. Reply `15` must preserve the preceding player and scene.

Negative tests drive `RecordedStream` through the attached adapter and real `Client.tcpIn`. They cover unknown membership, both T1 paths, T2 rethrow after logout, handler under-read and over-read, and wrong decoded values. Malformed variable-length frames also fail through `replayRecording`.

The replay receipt names `Jpeg.decodeJpeg: jpeg-js` as a substituted boot step. Happy-dom does not load the title image, so the test harness decodes its captured JPEG bytes with the development-only decoder. Production `Pix32.fromJpeg`, archive loading, configuration initialization, and the rest of `maininit` still run. The bundle guard rejects this decoder in browser or worker output.

The synthetic login uses fixed public parameters and reply bytes; `RecordedStream` discards login writes. The receipt names this configuration substitution too. All login-key exports are preserved and restored, so replay does not depend on which test first imported the key module or change later tests' key state. Production RSA encoding and the successful-login reset still run.

Replay uses the production client frame and cache loaders. Its loopback archive server uses Bun's native HTTP types rather than happy-dom's replacements. Native fetch is scoped to the replay and its original property descriptor is restored even when replay fails. Replay does not exercise game sockets, the OnDemand wire parser, or rendering. The live capture covers the socket and OnDemand paths; renderer qualification remains a live-client check. Hosted CI can run the synthetic failures without a cache bundle and must state when a real cache-backed recording is skipped.
