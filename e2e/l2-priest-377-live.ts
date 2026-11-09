/** L2 377 quest cell: The Restless Ghost (record id `priest`) through AIOQuester and the 377 edition of `defs/restlessghost.ts`.
 *  Audit RS2B0T-377-L2-1108/audit/priest.md; content cb6cc5ea1: father_aereck.rs2:45 (prieststart 0 -> 1), father_urhney.rs2:50-51 (2, Ghostspeak amulet),
 *  restless_ghost.rs2:138 (3), quest_priest.rs2:73-79 (4, skeleton appears), quest_priest.rs2:55-63 and :94-98 (5, qp 0 -> 1, Prayer +1,125 XP).
 *  No quest, item, XP or position seed: the only setup is mainlandAccount. AIOQuester stays revision 289 (it carries every quest module),
 *  so the cell starts it through the explicit runUnqualified override. */
import type { Page } from 'playwright-core';

import { countOf, runL2Cell, type L2VarChange } from './lib/l2LiveHarness.js';

const QUEST = 'The Restless Ghost';
const VARS = ['prieststart', 'qp'] as const;
/** The quest skull `ghostskull` (pack/obj.pack:554) and the generic same-named `skull` (pack/obj.pack:965). */
const QUEST_SKULL_ID = 553;
const GENERIC_SKULL_ID = 964;
const AMULET = 'Ghostspeak amulet';
const PRAYER_REWARD_XP = 1125;

type Abi = {
    __rs2b0t: {
        Quests: { status(name: string): string };
        Equipment: { contains(name: string): boolean };
        Inventory: { countById(id: number): number };
        Skills: { effective(name: string): number; level(name: string): number };
    };
};

type Vitals = { at: string; hp: number; maxHp: number; questSkull: number; genericSkull: number };

async function journal(page: Page): Promise<string> {
    return page.evaluate(name => (globalThis as never as Abi).__rs2b0t.Quests.status(name), QUEST);
}

async function amuletWorn(page: Page): Promise<boolean> {
    return page.evaluate(name => (globalThis as never as Abi).__rs2b0t.Equipment.contains(name), AMULET);
}

/** Samples hitpoints and the two skull object ids once a second while the product runs; `stop` returns every sample. */
function sampleVitals(page: Page): { stop(): Promise<Vitals[]> } {
    const samples: Vitals[] = [];
    let running = true;
    const loop = (async () => {
        while (running) {
            const sample = await page
                .evaluate(
                    ({ quest, generic }) => {
                        const api = (globalThis as never as Abi).__rs2b0t;
                        return {
                            hp: api.Skills.effective('hitpoints'),
                            maxHp: api.Skills.level('hitpoints'),
                            questSkull: api.Inventory.countById(quest),
                            genericSkull: api.Inventory.countById(generic)
                        };
                    },
                    { quest: QUEST_SKULL_ID, generic: GENERIC_SKULL_ID }
                )
                .catch(() => null);
            if (sample) samples.push({ at: new Date().toISOString(), ...sample });
            await page.waitForTimeout(1000).catch(() => undefined);
        }
    })();
    return {
        stop: async () => {
            running = false;
            await loop;
            return samples;
        }
    };
}

/** The values `name` took, in order, without repeats. */
function sequence(timeline: readonly L2VarChange[], name: string, start: number | null): (number | null)[] {
    const out: (number | null)[] = [start];
    for (const change of timeline) if (change.name === name && change.value !== out[out.length - 1]) out.push(change.value);
    return out;
}

await runL2Cell({
    cell: 'priest',
    receiptFile: 'l2-priest-receipts.json',
    why: 'AIOQuester runs The Restless Ghost from a fresh account with no quest, item or position seed; fresh ::getvar replies watch prieststart and qp while it runs; Prayer experience, the quest list row and the pack are read before, after and after a relog',
    execute: async ctx => {
        const before = await ctx.snapshot('before', { vars: VARS, xp: ['prayer'] });
        const journalBefore = await journal(ctx.page);
        ctx.check('before: fresh quest state', before.vars.prieststart === 0 && before.vars.qp === 0, JSON.stringify(before.vars));
        ctx.check('before: no Prayer experience, quest row not started', before.xp.prayer === 0 && journalBefore === 'notStarted', `prayer xp=${before.xp.prayer} journal=${journalBefore}`);
        ctx.check('before: no amulet or skull held', countOf(before.inventory, AMULET) === 0 && countOf(before.inventory, 'Skull') === 0, JSON.stringify(before.inventory));

        ctx.step('run AIOQuester with quests=priest until the queue drains');
        const vitals = sampleVitals(ctx.page);
        const result = await ctx.runScript('AIOQuester', { quests: 'priest' }, 25 * 60_000, { runUnqualified: true, watch: VARS });
        const samples = await vitals.stop();
        ctx.check('quester stopped with the queue drained', !result.timedOut && /queue drained/i.test(result.stopReason ?? ''), `state=${result.state} reason=${result.stopReason ?? 'none'}`);

        const prieststart = sequence(result.timeline, 'prieststart', before.vars.prieststart ?? null);
        const qp = sequence(result.timeline, 'qp', before.vars.qp ?? null);
        ctx.step(`observed prieststart ${prieststart.join(' -> ')}; qp ${qp.join(' -> ')}`);
        ctx.check('product wrote prieststart 0 -> 1 -> 2 -> 3 -> 4 -> 5', JSON.stringify(prieststart) === '[0,1,2,3,4,5]', prieststart.join(' -> '));
        ctx.check('product wrote qp 0 -> 1', JSON.stringify(qp) === '[0,1]', qp.join(' -> '));
        const minHp = samples.length ? Math.min(...samples.map(sample => sample.hp)) : null;
        const maxHp = samples.length ? Math.max(...samples.map(sample => sample.maxHp)) : null;
        ctx.step(`vitals: ${samples.length} samples, lowest hitpoints ${minHp} of ${maxHp}`);
        ctx.check('the product carried the quest skull, obj 553, and never the generic skull', samples.some(sample => sample.questSkull > 0) && samples.every(sample => sample.genericSkull === 0), `quest skull seen in ${samples.filter(sample => sample.questSkull > 0).length}/${samples.length} samples, generic skull in ${samples.filter(sample => sample.genericSkull > 0).length}`);
        const messages = result.log.join('\n');
        ctx.check('no death during the run', !/died during/i.test(messages), `lowest hitpoints ${minHp} of ${maxHp}`);

        const after = await ctx.snapshot('after', { vars: VARS, xp: ['prayer'] });
        const journalAfter = await journal(ctx.page);
        ctx.check('after: prieststart 5, qp 1, Prayer +1,125 XP', after.vars.prieststart === 5 && after.vars.qp === 1 && after.xp.prayer === before.xp.prayer + PRAYER_REWARD_XP, `${JSON.stringify(after.vars)} prayer xp=${after.xp.prayer}`);
        ctx.check('after: quest row complete', journalAfter === 'complete', journalAfter);
        ctx.check('after: skull handed in, amulet worn', countOf(after.inventory, 'Skull') === 0 && (await amuletWorn(ctx.page)), JSON.stringify(after.inventory));

        ctx.step('clean relog: the login payload carries the server state');
        await ctx.relog();
        const relogged = await ctx.snapshot('after-relog', { vars: VARS, xp: ['prayer'] });
        const journalRelog = await journal(ctx.page);
        ctx.check('after relog: completion persisted', relogged.vars.prieststart === 5 && relogged.vars.qp === 1 && relogged.xp.prayer === before.xp.prayer + PRAYER_REWARD_XP && journalRelog === 'complete', `${JSON.stringify(relogged.vars)} prayer xp=${relogged.xp.prayer} journal=${journalRelog}`);
    }
});
