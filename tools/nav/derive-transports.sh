#!/bin/sh
set -eu

check=0
if [ "${1:-}" = "--check" ] && [ $# -eq 1 ]; then
    check=1
elif [ $# -gt 0 ]; then
    echo "usage: sh tools/nav/derive-transports.sh [--check]" >&2
    exit 2
fi

engine_dir=${ENGINE_DIR:-}
content_dir=${CONTENT_DIR:-}
pack_path=${NAV_PACK_PATH:-out/collision.lcnav.gz}
data_root=${NAV_DATA_ROOT:-.}
data_dir="$data_root/src/bot/event/webwalk/data"
bun_bin=${BUN_BIN:-bun}
python_bin=${PYTHON_BIN:-python3}

if [ -z "$engine_dir" ] || [ -z "$content_dir" ]; then
    echo "Set ENGINE_DIR to Engine-TS and CONTENT_DIR to LostCity Content." >&2
    exit 2
fi

committed_dir=$data_dir
if [ "$check" = 1 ]; then
    # Why: the ladder and enrichment stages rewrite stairEdges.json and transports.json in place, so only the whole pipeline, rerun from the committed inputs in a scratch root, can be compared with the committed files.
    scratch=$(mktemp -d "${TMPDIR:-/tmp}/derive-transports.XXXXXX")
    trap 'rm -rf "$scratch"' EXIT
    mkdir -p "$scratch/src/bot/event/webwalk/data" "$scratch/tools/nav"
    cp "$data_dir/transports.json" "$scratch/src/bot/event/webwalk/data/transports.json"
    cp "$data_root/tools/nav/stair-prices.json" "$scratch/tools/nav/stair-prices.json"
    data_root=$scratch
    data_dir="$data_root/src/bot/event/webwalk/data"
fi
export NAV_DATA_ROOT="$data_root"

"$bun_bin" tools/nav/derive-stairs.ts \
    --engine "$engine_dir" \
    --content "$content_dir" \
    --pack "$pack_path" \
    --data-dir "$data_dir" \
    --out "$data_dir/stairEdges.json"
"$python_bin" tools/nav/derive-ladders.py \
    --engine "$engine_dir" \
    --content "$content_dir" \
    --pack "$pack_path" \
    --rs2b0t "$data_root"
"$python_bin" tools/nav/enrich-transports.py \
    --content "$content_dir" \
    --rs2b0t "$data_root" \
    --transports-output "$data_dir/transports.json" \
    --stairs-output "$data_dir/stairEdges.json"
"$bun_bin" tools/nav/fix-stair-approaches.ts \
    --engine "$engine_dir" \
    --pack "$pack_path" \
    --out "$data_dir/stairEdges.json" \
    --transports "$data_dir/transports.json"

if [ "$check" = 1 ]; then
    stale=0
    for name in stairEdges.json transports.json; do
        if cmp -s "$data_dir/$name" "$committed_dir/$name"; then
            echo "ok: $committed_dir/$name is up to date"
        else
            echo "STALE: $committed_dir/$name — run sh tools/nav/derive-transports.sh"
            stale=1
        fi
    done
    exit "$stale"
fi
