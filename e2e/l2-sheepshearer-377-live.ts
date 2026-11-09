/** L2 377 quest cell: Sheep Shearer through AIOQuester and the 377 wool execution path.
 *  No quest, item, XP, or position seed. AIOQuester stays revision 289 and starts with the explicit runUnqualified override. */
import type { Page } from 'playwright-core';

import { countOf, runL2Cell, type L2VarChange } from './lib/l2LiveHarness.js';

// 377 content: interfaces/questlist.if:211,214 names the row; general/configs/quest.constant:12 sets completion to 22.
const QUEST = 'Sheep Shearer';
// 377 content: pack/varp.pack maps sheep to 179, qp to 101, and the_thing_sheared to 690.
const QUEST_VARS = ['sheep', 'qp', 'the_thing_sheared'] as const;
const WATCH_VARS = ['sheep', 'qp'] as const;

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
    cell: 'sheepshearer',
    receiptFile: 'l2-sheepshearer-receipts.json',
    why: 'AIOQuester runs Sheep Shearer on a fresh account with no quest, item, XP, or position seed; fresh ::getvar replies watch sheep and qp; the_thing_sheared, Crafting XP, coins, the quest row, and the pack are read before, after, and after relog',
    execute: async ctx => {
        const before = await ctx.snapshot('before', { vars: QUEST_VARS, xp: ['crafting'] });
        const journalBefore = await journal(ctx.page);
        ctx.check(
            'before: fresh quest state',
            before.vars.sheep === 0 && before.vars.qp === 0 && before.vars.the_thing_sheared === 0 && journalBefore === 'notStarted',
            `${JSON.stringify(before.vars)} journal=${journalBefore}`
        );
        ctx.check('before: no Crafting experience', before.xp.crafting === 0, `crafting xp=${before.xp.crafting}`);
        ctx.check(
            'before: no quest items or coins',
            ['Shears', 'Wool', 'Ball of wool', 'Coins'].every(item => countOf(before.inventory, item) === 0),
            JSON.stringify(before.inventory)
        );

        ctx.step('run AIOQuester with quests=sheep until the queue drains');
        const result = await ctx.runScript('AIOQuester', { quests: 'sheep' }, 20 * 60_000, { runUnqualified: true, watch: WATCH_VARS });
        ctx.check('quester stopped with the queue drained', !result.timedOut && /queue drained/i.test(result.stopReason ?? ''), `state=${result.state} reason=${result.stopReason ?? 'none'}`);

        const sheep = sequence(result.timeline, 'sheep', before.vars.sheep);
        const qp = sequence(result.timeline, 'qp', before.vars.qp);
        // 377 content: fred_the_farmer.rs2:81-84 sets 1, :211-222 advances sheep one ball per loop up to 20, :224-234 and quest.constant:12 complete at 22.
        // Why: the watch samples getvar about once a second while Fred takes a ball every two ticks, so the ramp may skip values; require its shape, not every step.
        const rampOk = sheep[0] === 0 && sheep[1] === 1 && sheep.at(-2) === 20 && sheep.at(-1) === 22
            && sheep.every((value, index) => index === 0 || (value !== null && value > (sheep[index - 1] ?? -1) && value !== 21));
        ctx.step(`observed sheep ${sheep.join(' -> ')}; qp ${qp.join(' -> ')}`);
        ctx.check('product wrote sheep 0 -> 1 -> rising ramp -> 20 -> 22 (never 21)', rampOk, sheep.join(' -> '));
        ctx.check('product wrote qp 0 -> 1', JSON.stringify(qp) === '[0,1]', qp.join(' -> '));

        const after = await ctx.snapshot('after', { vars: QUEST_VARS, xp: ['crafting'] });
        const journalAfter = await journal(ctx.page);
        ctx.check(
            'after: sheep 22, qp 1, The Thing untouched, quest row complete',
            after.vars.sheep === 22 && after.vars.qp === 1 && after.vars.the_thing_sheared === 0 && journalAfter === 'complete',
            `${JSON.stringify(after.vars)} journal=${journalAfter}`
        );
        // 377 content: spinning.struct:8-12 gives 2.5 XP per wool; quest_sheep.rs2:1-7 rewards 150 XP and 60 coins.
        ctx.check(
            'after: 20 spins plus the 150 XP quest reward, and 60 coins',
            after.xp.crafting - before.xp.crafting === 200 && countOf(after.inventory, 'Coins') === 60,
            `crafting xp delta=${after.xp.crafting - before.xp.crafting}; coins=${countOf(after.inventory, 'Coins')}`
        );
        ctx.check(
            'after: the product gathered and handed in all 20 wool balls',
            countOf(after.inventory, 'Wool') === 0 && countOf(after.inventory, 'Ball of wool') === 0,
            JSON.stringify(after.inventory)
        );

        ctx.step('clean relog: verify the server login state');
        await ctx.relog();
        const relogged = await ctx.snapshot('after-relog', { vars: QUEST_VARS, xp: ['crafting'] });
        const journalRelog = await journal(ctx.page);
        ctx.check(
            'after relog: completion, reward, and untouched Thing persisted',
            relogged.vars.sheep === 22 && relogged.vars.qp === 1 && relogged.vars.the_thing_sheared === 0 &&
                relogged.xp.crafting === after.xp.crafting && countOf(relogged.inventory, 'Coins') === 60 && journalRelog === 'complete',
            `${JSON.stringify(relogged.vars)} crafting xp=${relogged.xp.crafting} coins=${countOf(relogged.inventory, 'Coins')} journal=${journalRelog}`
        );
    }
});
