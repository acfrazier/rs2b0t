/** L2 377 live cell: Rune Mysteries through AIOQuester on a fresh account.
 *  377 source: quest_runemysteries.constant:1-6 (stages 0..6), duke_horacio.rs2:29-34, sedridor.rs2:98-134, aubury.rs2:2-8,58-61, sedridor.rs2:140-180, quest_runemysteries.rs2:1-4.
 *  The only fixture is the audit-approved Mugger combat/food setup; no Runecrafting, quest varp, quest item or quest-point seed. */
import type { Page } from 'playwright-core';

import { countOf, runL2Cell, type L2VarChange } from './lib/l2LiveHarness.js';

const QUEST_ID = 'runemysteries'; // 377 record id: data/quests.ts:36-40; quest row: interfaces/questlist.if:76,79.
const QUEST = 'Rune Mysteries Quest'; // 377 quest-list row: interfaces/questlist.if:76,79.
const VARS = ['runemysteries', 'qp'] as const; // 377 stages: quests/quest_runemysteries/configs/quest_runemysteries.constant:1-6; QP reward: quest_runemysteries.rs2:1-4.
const QUEST_ITEMS = ['Air talisman', 'Research package', 'Notes'] as const; // 377 rewards/deliveries: duke_horacio.rs2:33-34, sedridor.rs2:120-129, aubury.rs2:6-8, sedridor.rs2:149-180.
const COMBAT_FIXTURE = [['attack', 40], ['strength', 40], ['defence', 40], ['hitpoints', 40]] as const; // Audit §3: this combat-only fixture exceeds the Mugger's vislevel-based aggro cutoff.
const EXPECTED_STAGES = [0, 1, 2, 3, 4, 5, 6] as const; // 377 values: quests/quest_runemysteries/configs/quest_runemysteries.constant:1-6.

type Abi = {
    __rs2b0t: {
        Quests: { status(name: string): string };
        Skills: { level(name: string): number };
        Inventory: { count(name: string): number };
    };
};

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
    cell: 'runemysteries',
    receiptFile: 'l2-runemysteries-receipts.json',
    why: 'AIOQuester completes Rune Mysteries from a fresh account; the labelled Attack/Strength/Defence/Hitpoints 40 and five-Trout fixture avoids the content Mugger without seeding quest state or items; fresh ::getvar replies watch runemysteries and qp, with the quest row and pack checked before, after and after relog',
    execute: async ctx => {
        const fresh = await ctx.snapshot('fresh', { vars: VARS });
        const freshJournal = await journal(ctx.page);
        ctx.check('fresh: quest not started and no quest points', fresh.vars.runemysteries === 0 && fresh.vars.qp === 0 && freshJournal === 'notStarted', `${JSON.stringify(fresh.vars)} journal=${freshJournal}`);
        ctx.check('fresh: no quest items or fixture food', QUEST_ITEMS.every(name => countOf(fresh.inventory, name) === 0) && countOf(fresh.inventory, 'Trout') === 0, JSON.stringify(fresh.inventory));

        ctx.step('seed the labelled Mugger combat fixture and five trout');
        for (const [skill, level] of COMBAT_FIXTURE) await ctx.cheat(`setstat ${skill} ${level}`, `Rune Mysteries Mugger-avoidance fixture: ${skill} level ${level}`);
        await ctx.cheat('give trout 5', 'Rune Mysteries Mugger fixture: five trout; no quest item seeded');
        const fixture = await ctx.page.evaluate(stats => {
            const api = (globalThis as never as Abi).__rs2b0t;
            return { levels: Object.fromEntries(stats.map(skill => [skill, api.Skills.level(skill)])), trout: api.Inventory.count('Trout') };
        }, COMBAT_FIXTURE.map(([skill]) => skill));
        ctx.check('fixture: combat stats 40 and five trout landed', COMBAT_FIXTURE.every(([skill, level]) => fixture.levels[skill] === level) && fixture.trout === 5, JSON.stringify(fixture));

        const before = await ctx.snapshot('before', { vars: VARS });
        const journalBefore = await journal(ctx.page);
        ctx.check('before: fixture did not change fresh quest state', before.vars.runemysteries === 0 && before.vars.qp === 0 && journalBefore === 'notStarted', `${JSON.stringify(before.vars)} journal=${journalBefore}`);
        ctx.check('before: no quest items seeded', QUEST_ITEMS.every(name => countOf(before.inventory, name) === 0), JSON.stringify(before.inventory));

        ctx.step('run AIOQuester with quests=runemysteries until the queue drains');
        const result = await ctx.runScript('AIOQuester', { quests: QUEST_ID }, 25 * 60_000, { runUnqualified: true, watch: VARS });
        ctx.check('quester stopped with the queue drained', !result.timedOut && /queue drained/i.test(result.stopReason ?? ''), `state=${result.state} reason=${result.stopReason ?? 'none'}`);

        const runemysteries = sequence(result.timeline, 'runemysteries', before.vars.runemysteries ?? null);
        const qp = sequence(result.timeline, 'qp', before.vars.qp ?? null);
        ctx.step(`observed runemysteries ${runemysteries.join(' -> ')}; qp ${qp.join(' -> ')}`);
        ctx.check('product wrote runemysteries 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6', JSON.stringify(runemysteries) === JSON.stringify(EXPECTED_STAGES), runemysteries.join(' -> '));
        ctx.check('product wrote qp 0 -> 1', JSON.stringify(qp) === '[0,1]', qp.join(' -> '));

        const after = await ctx.snapshot('after', { vars: VARS });
        const journalAfter = await journal(ctx.page);
        ctx.check('after: stage 6, qp 1 and quest row complete', after.vars.runemysteries === 6 && after.vars.qp === 1 && journalAfter === 'complete', `${JSON.stringify(after.vars)} journal=${journalAfter}`);
        ctx.check('after: Air talisman reward held; package and notes delivered', countOf(after.inventory, 'Air talisman') === 1 && countOf(after.inventory, 'Research package') === 0 && countOf(after.inventory, 'Notes') === 0, JSON.stringify(after.inventory));

        ctx.step('clean relog and read back server quest state, reward and pack');
        await ctx.relog();
        const relogged = await ctx.snapshot('after-relog', { vars: VARS });
        const journalRelog = await journal(ctx.page);
        ctx.check('after relog: completion and Rune Mysteries reward persisted', relogged.vars.runemysteries === 6 && relogged.vars.qp === 1 && journalRelog === 'complete' && countOf(relogged.inventory, 'Air talisman') === 1 && countOf(relogged.inventory, 'Research package') === 0 && countOf(relogged.inventory, 'Notes') === 0, `${JSON.stringify(relogged.vars)} journal=${journalRelog} pack=${JSON.stringify(relogged.inventory)}`);
    }
});
