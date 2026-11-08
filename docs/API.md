[Manual](README.md) › Scripting API

# Scripting API

`@rs2b0t/api` is the surface external scripts compile against. It reads the ABI the
client installs at `globalThis.__rs2b0t` and throws if `apiVersion` is not the one it
was built for.

## Publication

The external contract is the union of all three, not the npm barrel alone:

1. `@rs2b0t/api` (`index.js` and `index.d.ts`): types, overloads, public
   properties, inherited members, callable results, and protected subclass hooks
   such as `TaskBot.add`.
2. Properties installed on `globalThis.__rs2b0t`. Fourteen of those roots are
   absent from the npm barrel; their members stay publication-held until a
   publication ruling.
3. Surfaces named on the linked pages below, including `Paint.begin`,
   `paintState`, the `PaintFrame` widgets plus `end`, `RunManager.override`,
   `Prayer`, `EssenceSession`, `nearestAltar`, `BUILD_INFO`, `PartnerTrade`,
   cooking ranges, `locRef`, and `Area.rectangular` / `Area.circular`.

`reader` is an untyped record; its current public methods stay held. Installing a
runtime member does not publish it, but a runtime member that `index.d.ts` lacks
fails CI, and a `@internal` JSDoc tag keeps a member off the contract.
`bun run check:api-contract` also fails if a held name in this union disappears.

## Pages

| Page | Covers |
|---|---|
| [Write a bot](how-to/write-a-bot.md) | getting started, and a full worked example |
| [Bots](reference/api-bots.md) | `LoopingBot`, `TaskBot`, `TreeBot`, `Execution`, `defineBot` |
| [Paint](reference/api-paint.md) | the overlay HUD: tabs, scrolling lists, wrapping, docking |
| [Game](reference/api-game.md) | `Game`, camera, world primitives |
| [Entities](reference/api-entities.md) | queries, entity shapes |
| [Items](reference/api-items.md) | inventory, equipment, bank, acquisition |
| [Banking helpers](reference/api-banking.md) | deposit rules, keep lists, bank trips |
| [Skills](reference/api-skills.md) | `Skills`, `Prayer` |
| [Dialogue and trade](reference/api-dialogue.md) | `ChatDialog`, `Shop`, `Trade` |
| [Movement](reference/api-movement.md) | walking, nav teleports |
| [Quests](reference/api-quests.md) | the quest surface |
| [Events and settings](reference/api-events.md) | the event bus, script settings |
| World catalogs [1](reference/api-catalogs.md), [2](reference/api-catalogs-2.md) | banks, spells, drops, shops, clues |

## Published roots

| Root            | Members                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `Prayer`        | `points`, `max`, `full`, `known`, `available`, `active`, `set`, `clear`                        |
| `Reachability`  | `canReach`, `canStep`, `lineOfSight`, `walkable`, `probeable`, `arrivalProbe`                  |
| `SettingsStore` | `saved`, `save`, `onChange`, `displayString`, `resolve`, `globalBag`, `isUrlOverride`, `clear` |

`Reachability` uses the package's `WorldTile`, `ReachOptions`, and `ArrivalProbe`
types.

