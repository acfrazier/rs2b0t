/** L2 377 quest cell: Cook's Assistant through AIOQuester and the 377 edition of `defs/cooksassistant.ts`.
 *  Audit RS2B0T-377-L2-1108/audit/cooksassistant.md; content cb6cc5ea1: quest_cook.rs2:29-33 (cookquest 0 -> 1), windmills.rs2:85-92 (hopper_full 1),
 *  :107-121 (flour 1), :61-68 (Pot of flour), quest_cook.rs2:82-91 (cookquest 2, qp +1, Cooking +300 XP).
 *  The transitions match Route A (ROUTE-A-COOK-1106): cookquest 0 -> 1 -> 2, hopper_full 1, flour 1, qp 0 -> 1, Cooking XP 0 -> 300.
 *  No quest, item, mill, XP or position seed: the only setup is mainlandAccount. AIOQuester stays revision 289 (it carries every quest module),
 *  so the cell starts it through the explicit runUnqualified override. */
import type { Page } from 'playwright-core';

import { countOf, runL2Cell, type L2VarChange } from './lib/l2LiveHarness.js';

const QUEST = "Cook's Assistant";
const VARS = ['cookquest', 'hopper_full', 'flour', 'qp'] as const;
const INGREDIENTS = ['Egg', 'Bucket of milk', 'Pot of flour', 'Pot', 'Bucket', 'Grain'];

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
    cell: 'cooksassistant',
    receiptFile: 'l2-cooksassistant-receipts.json',
    why: "AIOQuester runs Cook's Assistant from a fresh account with no quest, item or position seed; fresh ::getvar replies watch cookquest, hopper_full, flour and qp while it runs; Cooking experience, the quest list row and the pack are read before, after and after a relog",
    execute: async ctx => {
        const before = await ctx.snapshot('before', { vars: VARS, xp: ['cooking'] });
        const journalBefore = await journal(ctx.page);
        ctx.check('before: fresh quest state', before.vars.cookquest === 0 && before.vars.qp === 0 && before.vars.hopper_full === 0 && before.vars.flour === 0, JSON.stringify(before.vars));
        ctx.check('before: no Cooking experience, quest row not started', before.xp.cooking === 0 && journalBefore === 'notStarted', `cooking xp=${before.xp.cooking} journal=${journalBefore}`);
        ctx.check('before: no ingredients held', INGREDIENTS.every(item => countOf(before.inventory, item) === 0), JSON.stringify(before.inventory));

        ctx.step('run AIOQuester with quests=cook until the queue drains');
        const result = await ctx.runScript('AIOQuester', { quests: 'cook' }, 20 * 60_000, { runUnqualified: true, watch: VARS });
        ctx.check('quester stopped with the queue drained', !result.timedOut && /queue drained/i.test(result.stopReason ?? ''), `state=${result.state} reason=${result.stopReason ?? 'none'}`);

        const cookquest = sequence(result.timeline, 'cookquest', before.vars.cookquest ?? null);
        const qp = sequence(result.timeline, 'qp', before.vars.qp ?? null);
        ctx.step(`observed cookquest ${cookquest.join(' -> ')}; qp ${qp.join(' -> ')}; hopper_full ${sequence(result.timeline, 'hopper_full', 0).join(' -> ')}; flour ${sequence(result.timeline, 'flour', 0).join(' -> ')}`);
        ctx.check('product wrote cookquest 0 -> 1 -> 2', JSON.stringify(cookquest) === '[0,1,2]', cookquest.join(' -> '));
        ctx.check('product wrote qp 0 -> 1', JSON.stringify(qp) === '[0,1]', qp.join(' -> '));
        ctx.check('the hopper was filled by the product (hopper_full 1)', result.timeline.some(change => change.name === 'hopper_full' && change.value === 1), 'hopper_full readback');
        ctx.check('the mill ground flour (flour 1)', result.timeline.some(change => change.name === 'flour' && change.value === 1), 'flour readback');
        const messages = result.log.join('\n');
        ctx.check('mill messages through the product', /putting the grain in the hopper/i.test(messages) && /emptying the flour bin/i.test(messages), 'quest log names the hopper fill and the bin');

        const after = await ctx.snapshot('after', { vars: VARS, xp: ['cooking'] });
        const journalAfter = await journal(ctx.page);
        ctx.check('after: cookquest 2, qp 1, Cooking +300 XP', after.vars.cookquest === 2 && after.vars.qp === 1 && after.xp.cooking === 300, `${JSON.stringify(after.vars)} cooking xp=${after.xp.cooking}`);
        ctx.check('after: quest row complete', journalAfter === 'complete', journalAfter);
        ctx.check('after: ingredients handed in', ['Egg', 'Bucket of milk', 'Pot of flour'].every(item => countOf(after.inventory, item) === 0), JSON.stringify(after.inventory));

        ctx.step('clean relog: the login payload carries the server state');
        await ctx.relog();
        const relogged = await ctx.snapshot('after-relog', { vars: ['cookquest', 'qp'], xp: ['cooking'] });
        const journalRelog = await journal(ctx.page);
        ctx.check('after relog: completion persisted', relogged.vars.cookquest === 2 && relogged.vars.qp === 1 && relogged.xp.cooking === 300 && journalRelog === 'complete', `${JSON.stringify(relogged.vars)} cooking xp=${relogged.xp.cooking} journal=${journalRelog}`);
    }
});
