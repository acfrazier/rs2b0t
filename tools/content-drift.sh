#!/usr/bin/env bash
# Compare the 377 content branch tip against the pinned content the staged 377 data was generated from.
# Usage: tools/content-drift.sh [branch-content-root] [pinned-content-root]
# Defaults: branch = the published 377 content branch (FR-vault/vendor/content, branch rs2-r377);
#           pinned = the canon content checkout the manifest pins (data/manifest.json content.commit,
#           at cb6cc5ea1 for the 1108 data). A diff means the staged data is stale and P4a/S9 must re-run.
# Why these dirs: every 377-qualified constant S9 stages cites one of them (pitfall 16) — mine.dbrow and
# runecraft.dbrow (miningRocks.ts, runeCraftLocations.ts), the trail riddles (killAnchors.ts), the desert
# rescue teleports (the camp box test), and the quest scripts L2 will qualify.
set -u
BRANCH="${1:-$HOME/experiments/FR-vault/vendor/content}"
# The pinned content the manifest records; pass it as the second argument or set CONTENT_DIR (the
# analysis knob), e.g. the canon content checkout. No path default lives in this file (public repo).
PINNED="${2:-${CONTENT_DIR:-}}"
if [ -z "$PINNED" ]; then
  echo "usage: tools/content-drift.sh [branch-content-root] <pinned-content-root> (or set CONTENT_DIR)" >&2
  exit 2
fi
DIRS=(skill_mining skill_runecraft minigames/game_trail quests/quest_cook quests/quest_sheep quests/quest_priest \
  quests/quest_runemysteries quests/quest_romeojuliet quests/quest_waterfall \
  quests/quest_vampire quests/quest_haunted quests/quest_doric quests/quest_squire \
  quests/quest_gobdip quests/quest_blackknight quests/quest_hunt quests/quest_ball \
  quests/quest_imp quests/quest_hetty quests/quest_desertrescue)
status=0
for d in "${DIRS[@]}"; do
  if ! diff -rq "$BRANCH/scripts/$d" "$PINNED/scripts/$d" >/tmp/drift.$$ 2>&1; then
    echo "DRIFT: $d"; cat /tmp/drift.$$; status=1
  else
    echo "ok: $d"
  fi
done
rm -f /tmp/drift.$$
exit $status
