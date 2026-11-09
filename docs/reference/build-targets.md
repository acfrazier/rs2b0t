[Manual](../README.md) › [Dev and deploy](../DEV.md) › Build targets

# Build targets

The client branch selects the revision: `main` builds 289 and `rev377` builds 377.
`TARGET` selects the network and login-key behavior. It does not select the revision.

- **`local`** (default), **same-origin**: `wsHost = window.location.host`. Use the local
  development key, or `./tools/deploy-local-key.sh /path/to/engine` to derive the engine's
  values.

- **`proxy`**, used by `bun run b0t`, routes each profile's selected world through
  `tools/live-proxy.ts` on the serving origin. Game sockets, cache sockets, CRC/JAG downloads,
  and login-key refreshes use the same world prefix. The key uses `LIVE_RSAN`; the launcher
  checks all three live worlds before it builds.

- **`live`** retains direct `w1.rs2b2t.com` + `wss` for older harnesses without an explicit
  world. `?world=1`, `?world=2`, or `?world=3` uses the serving origin's world proxy. The key
  uses `LIVE_RSAN`.

- **`prod`** uses the same-origin connection like `local`, but it bakes the production RSA pair
  from `PROD_RSAE` and `PROD_RSAN`. This target serves the client from the game server
  (`w1.rs2b2t.com/rs2b0t`). Mixed-world profiles use its allowlisted `/__rs2b0t/world/1`,
  `/__rs2b0t/world/2`, and `/__rs2b0t/world/3` routes. Install those routes on every game
  proxy before publishing a mixed-world build. The build stops if either RSA value is unset.

## Local login key

The engine stores its private RSA key in `data/config/private.pem`. The `local` target
defaults to rs2b2t's rotated 1024-bit modulus. A stock engine creates a 512-bit key with a
large random exponent. Supply both public values or login returns code 6.

Node and Bun reject this exponent with `ERR_OSSL_BAD_E_VALUE`. Run these commands from the
engine root to read the public modulus and exponent:

```sh
cd /path/to/engine
HEX=$(openssl rsa -in data/config/private.pem -noout -modulus | sed 's/^Modulus=//')
bun -e "console.log(BigInt('0x$HEX').toString())"
openssl rsa -in data/config/private.pem -noout -text \
  | sed -n 's/^publicExponent: \([0-9][0-9]*\).*/\1/p'
```

This exponent command handles OpenSSL 3's one-line format.
The deployment helper also handles older OpenSSL and LibreSSL's multiline output.

Run the deployment helper from the client root to read both values and deploy:

```sh
./tools/deploy-local-key.sh /path/to/engine
```

## Build modes

`bun run build:all-targets` builds the `local` and `prod` targets for every browser and worker
entry. It writes the build record and 15 outputs under `out/`. A keyed production build needs
`PROD_RSAE` and `PROD_RSAN`.

```sh
bun run build:all-targets
bun run build:all-targets -- --dummy-rsa --plan
```

`--plan` prints the matrix without building and still checks production key configuration.
Use `--dummy-rsa --plan` when `PROD_RSAN` is unset. `--dummy-rsa` uses a fixed test key for
the production compile and marks `out/version.json` with `rsa: dummy`. Pack and deploy tools
refuse this artifact. It cannot prove login. Do not set `PROD_RSAN` when using
`--dummy-rsa`.

`bun run build:dev` builds the client entries in development mode. `bun run build:bot:dev`
builds the bot entries in development mode. These commands do not build the full target
matrix.

## Spessa audio assets

`package.json` pins `spessasynth_lib` at `4.3.13`. Both bundle builders copy
`node_modules/spessasynth_lib/dist/spessasynth_processor.min.js` to
`out/spessasynth_processor.min.js`. The deployment tools copy this processor beside the
bundles.

The 377 engine serves `SCC1_Florestan.sf2` from `public/client/`. The client loads it from
`/client/SCC1_Florestan.sf2`. Keep the soundfont in the engine's client directory. Do not
copy it beside the bot bundle.

`bun test test/tools/bundleDefines.test.ts` checks the built outputs, the processor, and the
absence of `tinymidipcm.wasm`.

## See also

- [Run the live wall](../how-to/run-the-live-wall.md)
