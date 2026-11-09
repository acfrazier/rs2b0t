/** L2 377 live cell: Doric's Quest through AIOQuester on a fresh account.
 *  377 source: quest_doric.rs2:75, 114 (stages 10 and 100), :86-92 (materials), :96-100 (180 coins), :113-117 (1,300 Mining XP and 1 QP).
 *  The only quest-related setup is the audit-approved labelled Mining 15 seed; no quest state or required item is seeded. */
import type { Page } from 'playwright-core';

import { countOf, runL2Cell, type L2VarChange } from './lib/l2LiveHarness.js';

const QUEST_ID = 'doric'; // 377 record id and row name: data/quests.ts:43-45; quest row: interfaces/questlist.if:91,94.
const QUEST = "Doric's Quest"; // 377 quest-list row: interfaces/questlist.if:91,94.
const VARS = ['doricquest', 'qp'] as const; // 377 private varp: quest_doric/configs/quest_doric.varp:1-2; QP reward: quest_doric.rs2:113-117.
const MATERIALS = [['Clay', 6], ['Copper ore', 4], ['Iron ore', 2]] as const; // 377 hand-in/removal: quest_doric.rs2:86-92.
const COIN_REWARD = 180; // 377 reward: quest_doric.rs2:96-100.
const MINING_XP_REWARD = 1300; // 377 reward: quest_doric.rs2:113-117.
const MATERIAL_MINING_XP = 6 * 5 + 4 * 17.5 + 2 * 35; // 377 mine.dbrow:23,39,76-77 gives 5/17.5/35 XP per Clay/Copper/Iron; quest_doric.rs2:86-92 requires 6/4/2.
const EXPECTED_STAGES = [0, 10, 100] as const; // 377 stages: quest_doric.rs2:14-19,75,114; quest.constant:3.

type Abi = { __rs2b0t: { Quests: { status(name: string): string }; Skills: { level(name: string): number } } };

async function journal(page: Page): Promise<string> {
    return page.evaluate(name => (globalThis as never as Abi).__rs2b0t.Quests.status(name), QUEST);
}

async function miningLevel(page: Page): Promise<number> {
    return page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Skills.level('mining'));
}

/** The values `name` took, in order, without repeats. */
function sequence(timeline: readonly L2VarChange[], name: string, start: number | null): (number | null)[] {
    const out: (number | null)[] = [start];
    for (const change of timeline) if (change.name === name && change.value !== out[out.length - 1]) out.push(change.value);
    return out;
}

await runL2Cell({
    cell: 'doric',
    receiptFile: 'l2-doric-receipts.json',
    why: 'AIOQuester completes Doric’s Quest from a fresh account; Mining 15 is the only labelled quest setup seed to permit iron mining; fresh ::getvar replies watch doricquest and qp, with Mining XP, the quest row and pack checked before, after and after relog',
    execute: async ctx => {
        const fresh = await ctx.snapshot('fresh', { vars: VARS, xp: ['mining'] });
        const freshJournal = await journal(ctx.page);
        ctx.check('fresh: quest not started and no quest points', fresh.vars.doricquest === 0 && fresh.vars.qp === 0 && freshJournal === 'notStarted', `${JSON.stringify(fresh.vars)} journal=${freshJournal}`);
        ctx.check('fresh: no quest materials or coins', MATERIALS.every(([name]) => countOf(fresh.inventory, name) === 0) && countOf(fresh.inventory, 'Coins') === 0, JSON.stringify(fresh.inventory));

        ctx.step('seed Mining 15 so Doric’s iron requirement does not require training');
        await ctx.cheat('setstat mining 15', 'Mining 15 setup seed allowed by the Doric audit; no quest state or quest item seeded');
        const before = await ctx.snapshot('before', { vars: VARS, xp: ['mining'] });
        const journalBefore = await journal(ctx.page);
        ctx.check('before: Mining 15 setup and unchanged fresh quest state', await miningLevel(ctx.page) === 15 && before.vars.doricquest === 0 && before.vars.qp === 0 && journalBefore === 'notStarted', `mining=${await miningLevel(ctx.page)} ${JSON.stringify(before.vars)} journal=${journalBefore}`);
        ctx.check('before: no quest materials or coins', MATERIALS.every(([name]) => countOf(before.inventory, name) === 0) && countOf(before.inventory, 'Coins') === 0, JSON.stringify(before.inventory));

        ctx.step('run AIOQuester with quests=doric until the queue drains');
        const result = await ctx.runScript('AIOQuester', { quests: QUEST_ID }, 25 * 60_000, { runUnqualified: true, watch: VARS });
        ctx.check('quester stopped with the queue drained', !result.timedOut && /queue drained/i.test(result.stopReason ?? ''), `state=${result.state} reason=${result.stopReason ?? 'none'}`);

        const doricquest = sequence(result.timeline, 'doricquest', before.vars.doricquest ?? null);
        const qp = sequence(result.timeline, 'qp', before.vars.qp ?? null);
        ctx.step(`observed doricquest ${doricquest.join(' -> ')}; qp ${qp.join(' -> ')}`);
        ctx.check('product wrote doricquest 0 -> 10 -> 100', JSON.stringify(doricquest) === JSON.stringify(EXPECTED_STAGES), doricquest.join(' -> '));
        ctx.check('product wrote qp 0 -> 1', JSON.stringify(qp) === '[0,1]', qp.join(' -> '));

        const after = await ctx.snapshot('after', { vars: VARS, xp: ['mining'] });
        const journalAfter = await journal(ctx.page);
        const miningXpDelta = after.xp.mining - before.xp.mining;
        const miningRewardXpDelta = miningXpDelta - MATERIAL_MINING_XP;
        const coinsDelta = countOf(after.inventory, 'Coins') - countOf(before.inventory, 'Coins');
        ctx.check('after: complete, qp 1 and Mining quest reward +1,300 XP', after.vars.doricquest === 100 && after.vars.qp === 1 && miningRewardXpDelta === MINING_XP_REWARD, `${JSON.stringify(after.vars)} total Mining XP delta=${miningXpDelta} minus ${MATERIAL_MINING_XP} ore XP = ${miningRewardXpDelta} quest-reward XP`);
        ctx.check('after: quest row complete', journalAfter === 'complete', journalAfter);
        ctx.check('after: materials removed and coins +180', MATERIALS.every(([name]) => countOf(after.inventory, name) === 0) && coinsDelta === COIN_REWARD, `coins delta=${coinsDelta}; pack=${JSON.stringify(after.inventory)}`);

        ctx.step('clean relog and read back server quest state, reward and pack');
        await ctx.relog();
        const relogged = await ctx.snapshot('after-relog', { vars: VARS, xp: ['mining'] });
        const journalRelog = await journal(ctx.page);
        const reloggedMiningDelta = relogged.xp.mining - before.xp.mining;
        const reloggedRewardXpDelta = reloggedMiningDelta - MATERIAL_MINING_XP;
        ctx.check('after relog: completion and rewards persisted', relogged.vars.doricquest === 100 && relogged.vars.qp === 1 && reloggedRewardXpDelta === MINING_XP_REWARD && journalRelog === 'complete' && countOf(relogged.inventory, 'Coins') - countOf(before.inventory, 'Coins') === COIN_REWARD && MATERIALS.every(([name]) => countOf(relogged.inventory, name) === 0), `${JSON.stringify(relogged.vars)} total Mining XP delta=${reloggedMiningDelta} minus ${MATERIAL_MINING_XP} ore XP = ${reloggedRewardXpDelta} quest-reward XP; journal=${journalRelog} pack=${JSON.stringify(relogged.inventory)}`);
    }
});
