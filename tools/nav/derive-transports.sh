#!/bin/sh
set -eu

engine_dir=${ENGINE_DIR:-}
content_dir=${CONTENT_DIR:-}
pack_path=${NAV_PACK_PATH:-out/collision.lcnav.gz}
data_root=${NAV_DATA_ROOT:-.}
data_dir="$data_root/src/bot/event/webwalk/data"
export NAV_DATA_ROOT="$data_root"
bun_bin=${BUN_BIN:-bun}
python_bin=${PYTHON_BIN:-python3}

if [ -z "$engine_dir" ] || [ -z "$content_dir" ]; then
    echo "Set ENGINE_DIR to Engine-TS and CONTENT_DIR to LostCity Content." >&2
    exit 2
fi

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
