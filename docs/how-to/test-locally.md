[Manual](../README.md) › [Running locally](../RUNNING.md) › Test, lint and smoke

# Test, lint and smoke locally

Run these from the repo root after the client is deployed, see [run locally](run-locally.md).

```sh
bun test                      # everything
bun test test/event/webwalk             # one directory
bun test test/docs            # the manual's own link integrity

bun run lint                             # eslint across the repo
bun run audit:exports                    # compiler census; writes out/audit-exports/integrated.json
bun run format src/bot/event/webwalk/Navigator.ts  # prettier, on paths you name

bun run smoke                                     # against localhost:8890
bun run smoke http://localhost:8888 user pass     # another engine, named account
```

`bunfig.toml` preloads `test/setup-dom.ts`, which registers happy-dom globally and sets
`STRICT_PACKETS=1 STRICT_CONFIG=1` before any client class is defined; that is what lets DOM
tests import client modules, and what makes a bad packet or config opcode fail under `bun test`.

`bun run lint` must pass before opening a pull request.

`format` deliberately takes explicit paths. The repo is not globally prettier-formatted,
so `prettier --write .` produces an enormous unrelated diff.

`bun run smoke` does **not** deploy, deploy first or it loads a stale client.

## See also

- [Run rs2b0t locally](run-locally.md), prerequisites through running a bot
- [Testing](../TESTING.md), suites and live harnesses
- [Build and data plumbing](build-and-data.md)
