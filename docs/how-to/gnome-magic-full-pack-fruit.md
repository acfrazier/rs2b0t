# GnomeMagicChopper full-pack Strange fruit

Run this local-only regression with an engine that permits account cheats:

```sh
ENGINE_DIR=/path/to/engine \
PROOF_DIR=./proof \
BOT_LIVE_NAME_PREFIX=gch \
bun e2e/gnome-fruit-bank-live.ts --base http://127.0.0.1:1080
```

The harness starts a fresh account with a Rune axe, 26 Knives, and one free backpack slot. After the first real Magic log bank trip, it adds one Strange fruit to that account so the fruit occupies the final slot with no logs held. The script must bank the fruit and resume chopping for woodcutting XP. The harness writes a receipt and screenshot and removes its isolated client files; it does not change or restart the engine.
