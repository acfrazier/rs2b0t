/** L2 377 quest cell: Witch's Potion through AIOQuester and the 377 edition of `defs/hetty.ts`.
 *  Audit RS2B0T-377-L2-1108/audit/hetty.md; content cb6cc5ea1: hetty.rs2:80 (`%hetty = ^hetty_started`, hetty 0 -> 1)
 *  then :15-24 (four pack items deleted, `%hetty = ^hetty_objects_given`, 1 -> 2),
 *  quest_hetty.rs2:1-13 (Drink From at stage 2 only; `%hetty = 3`, `stat_advance(magic, 3250)` = 325 XP, qp +1,
 *  scroll "Witches Potion Quest!" / "325 Magic XP").
 *  Wydin's shop stocks exactly 1 Raw beef (_unpack/727/all.inv:1186), so the module buys qty 1 and cooks the lone beef
 *  without opening the cookx menu (cooking.rs2:127-130); stage 2 reads the journal ("I should drink from the cauldron...").
 *  Coins are the only setup seed (Eye of newt 3 gp at Betty, Raw beef 1 gp at Wydin); the rat tail, onion and burnt meat
 *  come from the product's own kill, pick and cook. AIOQuester stays revision 289 (it carries every quest module),
 *  so the cell starts it through the explicit runUnqualified override. */
import type { Page } from 'playwright-core';

import { countOf, runL2Cell, type L2VarChange } from './lib/l2LiveHarness.js';

const QUEST = "Witch's Potion";
const VARS = ['hetty', 'qp'] as const;
const INGREDIENTS = ["Rat's tail", 'Onion', 'Eye of newt', 'Burnt meat'];
const COINS = 50;

type Abi = { __rs2b0t: { Quests: { status(name: string): string } } };

async function journal(page: Page): Promise<string> {
    return page.evaluate(name => (globalThis as never as Abi).__rs2b0t.Quests.status(name), QUEST);
}

/** The values `name` took, in order, without repeats. */
function sequence(timeline: readonly L2VarChange[], name: string, start: number | null): (number | null)[] {
    const out: (number | null)[] = [start];
    for (const change of timeline) if (change.name === name && change.value !== out[out.length - 1]) out.push(change.value);
    return out;
}

await runL2Cell({
    cell: 'hetty',
    receiptFile: 'l2-hetty-receipts.json',
    why: "AIOQuester runs Witch's Potion from a fresh account with coins for the two shop buys; fresh ::getvar replies watch hetty and qp while it runs; Magic experience, the quest list row and the pack are read before, after and after a relog",
    execute: async ctx => {
        await ctx.cheat(`give coins ${COINS}`, `inventory seeded with ${COINS} coins on this account for the Eye of newt (3 gp) and Raw beef (1 gp) shop buys`);
        const before = await ctx.snapshot('before', { vars: VARS, xp: ['magic', 'cooking'] });
        const journalBefore = await journal(ctx.page);
        ctx.check('before: fresh quest state', before.vars.hetty === 0 && before.vars.qp === 0, JSON.stringify(before.vars));
        ctx.check('before: no Magic experience, quest row not started', before.xp.magic === 0 && journalBefore === 'notStarted', `magic xp=${before.xp.magic} journal=${journalBefore}`);
        ctx.check('before: no ingredients held', INGREDIENTS.every(item => countOf(before.inventory, item) === 0), JSON.stringify(before.inventory));

        ctx.step('run AIOQuester with quests=hetty until the queue drains');
        const result = await ctx.runScript('AIOQuester', { quests: 'hetty' }, 20 * 60_000, { runUnqualified: true, watch: VARS });
        ctx.check('quester stopped with the queue drained', !result.timedOut && /queue drained/i.test(result.stopReason ?? ''), `state=${result.state} reason=${result.stopReason ?? 'none'}`);

        const hetty = sequence(result.timeline, 'hetty', before.vars.hetty ?? null);
        const qp = sequence(result.timeline, 'qp', before.vars.qp ?? null);
        ctx.step(`observed hetty ${hetty.join(' -> ')}; qp ${qp.join(' -> ')}`);
        ctx.check('product wrote hetty 0 -> 1 -> 2 -> 3', JSON.stringify(hetty) === '[0,1,2,3]', hetty.join(' -> '));
        ctx.check('product wrote qp 0 -> 1', JSON.stringify(qp) === '[0,1]', qp.join(' -> '));
        const messages = result.log.join('\n');
        ctx.check('hand-in and drink through the product', /handing the four ingredients to hetty/i.test(messages) && /drinking from the cauldron/i.test(messages), 'quest log names the hand-in and the drink');

        const after = await ctx.snapshot('after', { vars: VARS, xp: ['magic', 'cooking'] });
        const journalAfter = await journal(ctx.page);
        ctx.check('after: hetty 3, qp 1, Magic +325 XP', after.vars.hetty === 3 && after.vars.qp === 1 && after.xp.magic === 325, `${JSON.stringify(after.vars)} magic xp=${after.xp.magic} cooking xp=${after.xp.cooking}`);
        ctx.check('after: quest row complete', journalAfter === 'complete', journalAfter);
        ctx.check('after: ingredients handed in', INGREDIENTS.every(item => countOf(after.inventory, item) === 0), JSON.stringify(after.inventory));

        ctx.step('clean relog: the login payload carries the server state');
        await ctx.relog();
        const relogged = await ctx.snapshot('after-relog', { vars: VARS, xp: ['magic'] });
        const journalRelog = await journal(ctx.page);
        ctx.check('after relog: completion persisted', relogged.vars.hetty === 3 && relogged.vars.qp === 1 && relogged.xp.magic === 325 && journalRelog === 'complete', `${JSON.stringify(relogged.vars)} magic xp=${relogged.xp.magic} journal=${journalRelog}`);
    }
});
