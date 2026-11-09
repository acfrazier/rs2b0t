/** L2 377 template cell: the BoneBurier registry script empties banked Bones by burying them.
 *  Content cb6cc5ea1: bones.obj:1-12 (iop1=Bury, bone_exp 45 tenths), bury_bone.rs2:1-16 (stat_advance prayer by bone_exp).
 *  Run with ENGINE_DIR and L2_LIVE_EVIDENCE_DIR set; three fresh accounts by default (L2_LIVE_RUNS). */
import type { Page } from 'playwright-core';

import { countOf, runL2Cell } from './lib/l2LiveHarness.js';

const BONES = 10;
/** bones.obj:12 `param=bone_exp,45` is tenths of a point; the client shows whole experience. */
const XP_PER_BONE_TENTHS = 45;
const VARROCK_EAST_BANK = { x: 3253, z: 3420, level: 0 };

type BankAbi = {
    __rs2b0t: {
        Bank: {
            isOpen(): boolean;
            openNearest(boothName: string, op: string): Promise<boolean>;
            waitReady(timeoutMs?: number): Promise<boolean>;
            close(): Promise<boolean>;
        };
    };
};

async function openBank(page: Page): Promise<boolean> {
    return page.evaluate(async () => {
        const bank = (globalThis as never as BankAbi).__rs2b0t.Bank;
        return (await bank.openNearest('Bank booth', 'Use-quickly')) && (await bank.waitReady(6000));
    });
}

async function closeBank(page: Page): Promise<void> {
    await page.evaluate(() => (globalThis as never as BankAbi).__rs2b0t.Bank.close());
}

await runL2Cell({
    cell: 'boneburier',
    receiptFile: 'l2-boneburier-receipts.json',
    why: `BoneBurier (registry revision 377, no override) withdraws ${BONES} banked Bones at Varrock east bank, buries all of them and stops complete; server bank, inventory and Prayer experience are read before, after and after a relog`,
    execute: async ctx => {
        await ctx.tele(VARROCK_EAST_BANK, 'fixture start inside Varrock east bank');
        await ctx.cheat(`givebank bones ${BONES}`, `bank seeded with ${BONES} Bones on this account`);

        ctx.step('open the bank through Bank.openNearest for the before readback');
        if (!ctx.check('before: bank opens', await openBank(ctx.page), 'Bank booth Use-quickly')) return;
        const before = await ctx.snapshot('before', { xp: ['prayer'], bank: true });
        await closeBank(ctx.page);
        ctx.check('before: bank holds the seeded Bones', countOf(before.bank, 'Bones') === BONES, `bank Bones=${countOf(before.bank, 'Bones')}`);
        ctx.check('before: no Bones carried', countOf(before.inventory, 'Bones') === 0, `inventory Bones=${countOf(before.inventory, 'Bones')}`);

        ctx.step('run BoneBurier with boneName=Bones until it stops');
        const result = await ctx.runScript('BoneBurier', { boneName: 'Bones' }, 240_000);
        ctx.check('script stopped complete', !result.timedOut && /complete/i.test(result.stopReason ?? ''), `state=${result.state} reason=${result.stopReason ?? 'none'}`);

        const after = await ctx.snapshot('after', { xp: ['prayer'], bank: true });
        const gained = (after.xp.prayer ?? 0) - (before.xp.prayer ?? 0);
        const expected = Math.floor((BONES * XP_PER_BONE_TENTHS) / 10);
        ctx.check('after: Prayer experience from the product burials', gained === expected, `gained=${gained} expected=${expected}`);
        ctx.check('after: no Bones carried', countOf(after.inventory, 'Bones') === 0, `inventory Bones=${countOf(after.inventory, 'Bones')}`);

        ctx.step('reopen the bank: the server bank must hold no Bones');
        if (ctx.check('after: bank reopens', await openBank(ctx.page), 'Bank booth Use-quickly')) {
            const bank = await ctx.snapshot('after-bank', { bank: true });
            await closeBank(ctx.page);
            ctx.check('after: bank Bones gone', bank.bank !== null && countOf(bank.bank, 'Bones') === 0, `bank Bones=${countOf(bank.bank, 'Bones')}`);
        }

        ctx.step('clean relog: the login payload carries the server Prayer experience');
        await ctx.relog();
        const relogged = await ctx.snapshot('after-relog', { xp: ['prayer'] });
        ctx.check('after relog: Prayer experience persisted', relogged.xp.prayer === after.xp.prayer, `prayer xp=${relogged.xp.prayer} (after=${after.xp.prayer})`);
    }
});
