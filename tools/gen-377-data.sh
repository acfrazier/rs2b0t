#!/usr/bin/env bash
# P4a: build the revision-377 data set from fresh clones at pinned engine/content commits, then
# stage every generated module under data/377/ and write data/manifest.json (plan §3, pitfall 11).
#
# Why fresh clones: pack ids depend on build history (an inherited generated id map or map cache
# produces different bytes), so the engine and content are cloned --no-checkout at the pinned
# commits, the worldmap is packed explicitly (npm run build never calls packWorldmap), and only
# then do the generators run with REVISION=377 and --stage data/377/.
#
# Pinned toolchain: Node 26.12.0 is the version the clean-checkout 377 pack build was proven with
# (GAMEDATA-377-1105/clean-build.md); Bun 1.3.14 is the version hosted CI runs
# (.github/workflows/test.yml). Both are checked exactly and recorded in the manifest. Override
# only for a deliberate toolchain change, and then the recorded provenance changes with it.
#
# Inputs (environment):
#   GEN377_WORK          required; workspace for the fresh clones, build and logs (keep it off the
#                        repository; a second build passes a different GEN377_WORK and compares bytes)
#   GEN377_ENGINE_REPO   required; engine clone source (a local checkout or the pinned repository)
#   GEN377_CONTENT_REPO  required; content clone source
#   GEN377_NODE_MODULES  optional; a locked node_modules to copy into the engine clone (a fresh
#                        clone has none). Without it the script runs `npm ci` (needs the registry).
#   GEN377_OUT_DIR       where the basemap files are written and hashed from (default: out/, the
#                        repo's gitignored output dir; a byte-identity run passes a scratch dir and
#                        the recorded repo-relative paths stay out/… either way)
#   GEN377_NODE          optional; node binary (default: node on PATH)
#   GEN377_BUN           optional; bun binary (default: bun on PATH)
#   GEN377_NODE_VERSION  optional; expected `node --version` without the leading v (default: 26.12.0)
#   GEN377_BUN_VERSION   optional; expected `bun --version` (default: 1.3.14)
#   GEN377_SOURCE_BRANCH optional; branch the pinned commits are on (default: rs2-r377)
#
# The script never touches anything outside the repository's data/377/, the chosen out dir, and
# GEN377_WORK. The engine/content clones are disposable build inputs; their trees are never
# committed anywhere.
set -euo pipefail

ENGINE_COMMIT=bc47497ee8cf6148dbfb7239714ddd5045c40194
CONTENT_COMMIT=a15d0faa809f5f8455ef43e1ae4edfdd22512bb2
SOURCE_BRANCH=${GEN377_SOURCE_BRANCH:-rs2-r377}

PINNED_NODE=${GEN377_NODE_VERSION:-26.12.0}
PINNED_BUN=${GEN377_BUN_VERSION:-1.3.14}
NODE_BIN=${GEN377_NODE:-node}
BUN_BIN=${GEN377_BUN:-bun}

WORK=${GEN377_WORK:?GEN377_WORK is required (workspace for the fresh clones)}
ENGINE_REPO=${GEN377_ENGINE_REPO:?GEN377_ENGINE_REPO is required (engine clone source)}
CONTENT_REPO=${GEN377_CONTENT_REPO:?GEN377_CONTENT_REPO is required (content clone source)}
OUT_DIR=${GEN377_OUT_DIR:-out}
STAGE=data/377
REVISION=377

cd "$(dirname "$0")/.."   # the rs2b0t repository root
REPO=$PWD
ENGINE=$WORK/source/engine
mkdir -p "$WORK/source" "$WORK/logs"

sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d' ' -f1
    else
        shasum -a 256 "$1" | cut -d' ' -f1
    fi
}

echo "== toolchain =="
node_version=$("$NODE_BIN" --version)
bun_version=$("$BUN_BIN" --version)
echo "node $node_version (pin v$PINNED_NODE)"
echo "bun  $bun_version (pin $PINNED_BUN)"
test "$node_version" = "v$PINNED_NODE" || {
    echo "node is $node_version, the pinned toolchain is v$PINNED_NODE (override with GEN377_NODE_VERSION)" >&2
    exit 1
}
test "$bun_version" = "$PINNED_BUN" || {
    echo "bun is $bun_version, the pinned toolchain is $PINNED_BUN (override with GEN377_BUN_VERSION)" >&2
    exit 1
}
# The engine build runs `npm run build`; npm and tsx are shebang scripts, so the pinned node must
# win PATH resolution for them as well as for the direct call above.
NODE_DIR=$(cd "$(dirname "$(command -v "$NODE_BIN")")" && pwd)
export PATH="$NODE_DIR:$PATH"
echo "node on PATH: $(node --version)"

echo "== fresh clones =="
rm -rf "$WORK/source/engine" "$WORK/source/content"
# Why single-branch: the vendor checkouts are partial clones whose other refs are missing blobs;
# the pinned commits are ancestors of the published branch, so a branch-scoped clone is complete.
git clone --quiet --no-checkout --no-hardlinks --single-branch --branch "$SOURCE_BRANCH" "$ENGINE_REPO" "$WORK/source/engine"
git clone --quiet --no-checkout --no-hardlinks --single-branch --branch "$SOURCE_BRANCH" "$CONTENT_REPO" "$WORK/source/content"
git -C "$WORK/source/engine" rev-parse --verify --quiet "$ENGINE_COMMIT^{commit}" >/dev/null || {
    echo "engine clone does not contain $ENGINE_COMMIT on $SOURCE_BRANCH" >&2
    exit 1
}
git -C "$WORK/source/content" rev-parse --verify --quiet "$CONTENT_COMMIT^{commit}" >/dev/null || {
    echo "content clone does not contain $CONTENT_COMMIT on $SOURCE_BRANCH" >&2
    exit 1
}
git -C "$WORK/source/engine" checkout --quiet --detach "$ENGINE_COMMIT"
git -C "$WORK/source/content" checkout --quiet --detach "$CONTENT_COMMIT"
echo "engine  $(git -C "$WORK/source/engine" rev-parse HEAD)"
echo "content $(git -C "$WORK/source/content" rev-parse HEAD)"

# A dirty clone or inherited pack state would break the build-history guarantee.
test -z "$(git -C "$WORK/source/engine" status --porcelain --untracked-files=all)"
test -z "$(git -C "$WORK/source/content" status --porcelain --untracked-files=all)"
test -z "$(git -C "$WORK/source/content" ls-files --others --ignored --exclude-standard -- pack)"
echo "clones clean; no inherited pack state"

# Why this patch: `packWorldmap` at bc47497e is the 289-era packer. 377 content has 174 floors
# where its reference table has 103 (the loop reads past the table) and 377 moved fonts to
# PNG + .opt, so the eight legacy .fm loads throw. The disposable clone gets a compatibility
# patch that fills a missing floor colour from the floor's own `colour` and omits absent fonts
# (both clients fall back to their system font). It is recorded in the manifest generator hashes
# and in the P4a receipt; see tools/patches/worldmap-377.patch.
WORLDMAP_PATCH=$REPO/tools/patches/worldmap-377.patch
git -C "$ENGINE" apply --check --whitespace=nowarn "$WORLDMAP_PATCH"
git -C "$ENGINE" apply --whitespace=nowarn "$WORLDMAP_PATCH"
echo "worldmap patch $(sha256 "$WORLDMAP_PATCH")"

echo "== engine dependencies =="
if [ -n "${GEN377_NODE_MODULES:-}" ]; then
    cp -R "$GEN377_NODE_MODULES" "$ENGINE/node_modules"
    echo "node_modules copied from GEN377_NODE_MODULES"
else
    (cd "$ENGINE" && npm ci --no-audit --no-fund)
fi
echo "engine package-lock $(sha256 "$ENGINE/package-lock.json")"

echo "== engine pack build (NODE_MEMBERS=true BUILD_VERIFY=false) =="
(cd "$ENGINE" && NODE_MEMBERS=true BUILD_VERIFY=false npm run build) 2>&1 | tee "$WORK/logs/build.log"

echo "== packWorldmap (npm run build never packs it) =="
# The runner lives inside the disposable clone so the engine's own `#tools/*` subpath imports
# resolve; it is created here and never committed to any repository.
# Why MapPack.reload: the packer walks MapPack, whose module-level auto-reload is a no-op in a
# fresh process; without it the jag would contain no map squares.
printf 'import { MapPack } from "#tools/pack/PackFile.js";\nimport { packWorldmap } from "#tools/pack/map/Worldmap.js";\n\nMapPack.reload();\nawait packWorldmap();\n' > "$ENGINE/.gen377-worldmap.mts"
(cd "$ENGINE" && NODE_MEMBERS=true ./node_modules/.bin/tsx .gen377-worldmap.mts) 2>&1 | tee "$WORK/logs/worldmap.log"
for artifact in \
    data/pack/mapview/worldmap.jag \
    data/pack/client/config \
    data/pack/client/interface \
    data/pack/server/loc.dat \
    data/pack/.cache/maps-server.zip
do
    test -s "$ENGINE/$artifact" || {
        echo "engine build did not produce $artifact" >&2
        exit 1
    }
done
echo "worldmap.jag $(wc -c < "$ENGINE/data/pack/mapview/worldmap.jag") bytes"

echo "== generators (REVISION=$REVISION, staged under $STAGE/) =="
GENERATORS=(
    "tools/items/gen-itemdb.ts"
    "tools/shops/gen-shopdb.ts"
    "tools/items/gen-untradeable.ts"
    "tools/items/gen-namecollisions.ts"
    "tools/combat/gen-dropdb.ts"
    "tools/combat/gen-spelldb.ts"
    "tools/clues/gen-cluedb.ts"
    "tools/cooking/gen-cooksurfaces.ts"
    "tools/gen-ifids.ts"
)
for gen in "${GENERATORS[@]}"; do
    echo "-- $gen"
    REVISION=$REVISION CONTENT_DIR="$WORK/source/content" ENGINE_DIR="$ENGINE" \
        "$BUN_BIN" "$gen" --stage "$STAGE" 2>&1 | tee -a "$WORK/logs/generators.log"
    REVISION=$REVISION CONTENT_DIR="$WORK/source/content" ENGINE_DIR="$ENGINE" \
        "$BUN_BIN" "$gen" --stage "$STAGE" --check 2>&1 | tee -a "$WORK/logs/generators.log"
done

echo "== basemap (--no-fetch; the jag comes from the pack build) =="
mkdir -p "$OUT_DIR"
# A stale worldmap-* from another revision would enter the manifest as an out row of this run.
rm -f "$OUT_DIR"/worldmap-*
REVISION=$REVISION "$BUN_BIN" tools/map/build-basemap.ts \
    --engine "$ENGINE" \
    --jag "$ENGINE/data/pack/mapview/worldmap.jag" \
    --no-fetch \
    --out "$OUT_DIR" 2>&1 | tee "$WORK/logs/basemap.log"
test -n "$(ls "$OUT_DIR"/worldmap-basemap.*.png 2>/dev/null)" || {
    echo "no basemap files under $OUT_DIR" >&2
    exit 1
}
echo "== navigation bake (REVISION=$REVISION, staged under $STAGE/) =="
NAV_DATA_ROOT="$STAGE"
NAV_DATA_DIR="$NAV_DATA_ROOT/src/bot/event/webwalk/data"
NAV_WORK="$WORK/nav"
mkdir -p "$NAV_DATA_DIR" "$NAV_DATA_ROOT/tools/nav" "$NAV_DATA_ROOT/out" "$NAV_WORK"
cp tools/nav/door-categories.json "$NAV_DATA_ROOT/tools/nav/door-categories.json"
cp tools/nav/stair-prices.json "$NAV_DATA_ROOT/tools/nav/stair-prices.json"
# The 377 bake starts from the checked-in 289 transport seed, then regenerates both graphs.
cp src/bot/event/webwalk/data/transports.json "$NAV_DATA_DIR/transports.json"
cp src/bot/event/webwalk/data/stairEdges.json "$NAV_DATA_DIR/stairEdges.json"
rm -f "$NAV_DATA_ROOT/out/collision.lcnav" "$NAV_DATA_ROOT/out/collision.lcnav.gz"
REVISION=$REVISION ENGINE_DIR="$ENGINE" "$BUN_BIN" tools/nav/build-collision.ts \
    --engine "$ENGINE" \
    --out "$NAV_WORK/collision.lcnav" 2>&1 | tee "$WORK/logs/nav-collision.log"
cp "$NAV_WORK/collision.lcnav.gz" "$NAV_DATA_ROOT/out/collision.lcnav.gz"
REVISION=$REVISION ENGINE_DIR="$ENGINE" CONTENT_DIR="$WORK/source/content" \
    "$BUN_BIN" tools/nav/derive-doors.ts \
    --engine "$ENGINE" \
    --content "$WORK/source/content" \
    --out "$NAV_DATA_DIR/doors.json" 2>&1 | tee "$WORK/logs/nav-doors.log"
REVISION=$REVISION ENGINE_DIR="$ENGINE" CONTENT_DIR="$WORK/source/content" \
NAV_DATA_ROOT="$NAV_DATA_ROOT" NAV_PACK_PATH="$NAV_DATA_ROOT/out/collision.lcnav.gz" \
BUN_BIN="$BUN_BIN" PYTHON_BIN="${PYTHON_BIN:-python3}" \
    sh tools/nav/derive-transports.sh 2>&1 | tee "$WORK/logs/nav-transports.log"


echo "== manifest =="
ARTIFACT_ARGS=()
for path in \
    src/bot/data/itemdb.ts \
    src/bot/data/shopdb.ts \
    src/bot/data/untradeable.ts \
    src/bot/data/nameCollisions.ts \
    src/bot/data/dropdb.ts \
    src/bot/data/spelldb.ts \
    src/bot/data/cookSurfaceLocs.ts \
    src/bot/api/ai/clues/data/cluedb.ts \
    src/bot/api/ai/clues/data/puzzlePieces.ts \
    src/bot/data/ifIds.ts \
    src/bot/event/webwalk/data/doors.json \
    src/bot/event/webwalk/data/stairEdges.json \
    src/bot/event/webwalk/data/transports.json
do
    ARTIFACT_ARGS+=(--artifact "$STAGE/$path=generated")
done
ARTIFACT_ARGS+=(--artifact "$STAGE/tools/nav/door-categories.json=nav-input")
ARTIFACT_ARGS+=(--artifact "$STAGE/tools/nav/stair-prices.json=nav-input")
ARTIFACT_ARGS+=(--artifact "$STAGE/out/collision.lcnav.gz=out")

GEN_ARGS=()
for gen in \
    tools/shops/gen-shopdb.ts tools/shops/parse.ts \
    tools/items/gen-itemdb.ts tools/items/gen-untradeable.ts tools/items/gen-namecollisions.ts tools/items/parse.ts \
    tools/combat/gen-dropdb.ts tools/combat/gen-spelldb.ts \
    tools/clues/gen-cluedb.ts tools/clues/cluesParse.ts \
    tools/cooking/gen-cooksurfaces.ts \
    tools/gen-ifids.ts \
    tools/map/build-basemap.ts tools/map/encodePng.ts \
    tools/nav/lib.ts tools/nav/stairsParse.ts \
    tools/lib/content.ts tools/lib/genout.ts \
    tools/gen-377-manifest.ts tools/gen-377-data.sh tools/patches/worldmap-377.patch \
    tools/nav/build-collision.ts tools/nav/derive-doors.ts tools/nav/derive-stairs.ts \
    tools/nav/derive-ladders.py tools/nav/enrich-transports.py tools/nav/derive-transports.sh
do
    GEN_ARGS+=(--generator "$gen")
done
"$BUN_BIN" tools/gen-377-manifest.ts \
    --revision "$REVISION" \
    --engine-dir "$ENGINE" \
    --engine-commit "$ENGINE_COMMIT" \
    --content-commit "$CONTENT_COMMIT" \
    --node "$node_version" \
    --bun "$bun_version" \
    --out-dir "$OUT_DIR" \
    "${GEN_ARGS[@]}" \
    "${ARTIFACT_ARGS[@]}"

echo "== verify =="
"$BUN_BIN" tools/lib/manifest.ts verify

echo "PASS gen-377-data ($WORK)"
