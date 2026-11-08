/** L2 377 template cell: shop and bank round trip through the Shop and Bank APIs at Varrock.
 *  Content cb6cc5ea1: generalshop.rs2:3 (generalshopkeeper2, Varrock), _unpack/727/all.inv:59-72 (generalshop2 stocks cake_tin 2),
 *  cakes.obj `cake_tin` cost=10 (a 1-coin item sells back for 0, which proves nothing), maps/m50_53.jm2 NPC `0 18 23: 522` (Shop keeper at 3218,3415),
 *  bank_booth.loc:1-6 and bank_booth.rs2:7 (Use-quickly opens the bank).
 *  Run with ENGINE_DIR and L2_LIVE_EVIDENCE_DIR set; three fresh accounts by default (L2_LIVE_RUNS). */
import type { Page } from 'playwright-core';

import { cheb } from './lib/navLiveHarness.js';
import { countOf, runL2Cell, type L2RunContext } from './lib/l2LiveHarness.js';

const COINS = 200;
const ITEM = 'Cake tin';
const SHOP_KEEPER = 'Shop keeper';
const GENERAL_STORE = { x: 3216, z: 3415, level: 0 };
const VARROCK_EAST_BANK = { x: 3253, z: 3420, level: 0 };

type Abi = {
    __rs2b0t: {
        Shop: {
            isOpen(): boolean;
            open(npcName: string): Promise<boolean>;
            stock(): { name: string; count: number }[];
            buy(name: string, n: number): Promise<number>;
            sell(name: string, n: number): Promise<number>;
            close(): Promise<void>;
        };
        Bank: {
            isOpen(): boolean;
            openNearest(boothName: string, op: string): Promise<boolean>;
            waitReady(timeoutMs?: number): Promise<boolean>;
            deposit(name: string, op?: string): boolean | Promise<boolean>;
            withdraw(name: string, op?: string): boolean | Promise<boolean>;
            count(name: string): number;
            close(): Promise<boolean>;
        };
        Inventory: { count(name: string): number };
        Execution: { delayUntil(condition: () => boolean, timeout: number): Promise<boolean> };
    };
};

async function openShop(page: Page): Promise<{ open: boolean; stock: number }> {
    return page.evaluate(async ({ keeper, item }) => {
        const shop = (globalThis as never as Abi).__rs2b0t.Shop;
        const open = await shop.open(keeper);
        return { open, stock: shop.stock().find(row => row.name === item)?.count ?? -1 };
    }, { keeper: SHOP_KEEPER, item: ITEM });
}

async function openBank(page: Page): Promise<boolean> {
    return page.evaluate(async () => {
        const bank = (globalThis as never as Abi).__rs2b0t.Bank;
        return (await bank.openNearest('Bank booth', 'Use-quickly')) && (await bank.waitReady(6000));
    });
}

/** Run one bank op and wait until the server-sent pack count moves. */
async function bankMove(page: Page, op: 'deposit' | 'withdraw'): Promise<boolean> {
    return page.evaluate(
        async ({ kind, item }) => {
            const g = (globalThis as never as Abi).__rs2b0t;
            const before = g.Inventory.count(item);
            const sent = kind === 'deposit' ? await g.Bank.deposit(item, 'Deposit-1') : await g.Bank.withdraw(item, 'Withdraw-1');
            return sent && (await g.Execution.delayUntil(() => g.Inventory.count(item) !== before, 4000));
        },
        { kind: op, item: ITEM }
    );
}

async function walkChecked(ctx: L2RunContext, dest: { x: number; z: number; level: number }, radius: number, label: string): Promise<boolean> {
    const result = await ctx.walk(dest, radius, label);
    const distance = result.tile ? cheb(result.tile, dest) : 9999;
    return ctx.check(`walk ${label}`, result.walkOk && distance <= radius, `walkOk=${result.walkOk} tile=${result.tile ? `${result.tile.x},${result.tile.z},L${result.tile.level}` : 'null'} distance=${distance}`);
}

await runL2Cell({
    cell: 'bankshop',
    receiptFile: 'l2-bankshop-receipts.json',
    why: `buy one ${ITEM} from the Varrock general store, walk to Varrock east bank, deposit it, relog, withdraw it, walk back and sell it; server inventory, coins and bank are read before, between legs, after and after a relog`,
    execute: async ctx => {
        await ctx.cheat(`give coins ${COINS}`, `inventory seeded with ${COINS} coins on this account`);
        await ctx.tele(GENERAL_STORE, 'fixture start inside the Varrock general store');
        const before = await ctx.snapshot('before', {});
        ctx.check('before: seeded coins only', countOf(before.inventory, 'Coins') === COINS && countOf(before.inventory, ITEM) === 0, `coins=${countOf(before.inventory, 'Coins')} ${ITEM}=${countOf(before.inventory, ITEM)}`);

        ctx.step(`Shop.open('${SHOP_KEEPER}') then Shop.buy('${ITEM}', 1)`);
        const shop = await openShop(ctx.page);
        if (!ctx.check('shop opens with stock', shop.open && shop.stock > 0, `${ITEM} stock=${shop.stock}`)) return;
        const bought = await ctx.page.evaluate(item => (globalThis as never as Abi).__rs2b0t.Shop.buy(item, 1), ITEM);
        await ctx.page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Shop.close());
        const afterBuy = await ctx.snapshot('after-buy', {});
        const price = COINS - countOf(afterBuy.inventory, 'Coins');
        ctx.check('buy: one item for coins', bought === 1 && countOf(afterBuy.inventory, ITEM) === 1 && price > 0, `bought=${bought} ${ITEM}=${countOf(afterBuy.inventory, ITEM)} price=${price}`);

        if (!(await walkChecked(ctx, VARROCK_EAST_BANK, 3, 'shop to bank'))) return;
        ctx.step(`Bank.openNearest, Bank.deposit('${ITEM}')`);
        if (!ctx.check('bank opens', await openBank(ctx.page), 'Bank booth Use-quickly')) return;
        const bankBefore = await ctx.snapshot('bank-before-deposit', { bank: true });
        ctx.check('bank: item not banked yet', countOf(bankBefore.bank, ITEM) === 0, `bank ${ITEM}=${countOf(bankBefore.bank, ITEM)}`);
        const deposited = await bankMove(ctx.page, 'deposit');
        const afterDeposit = await ctx.snapshot('after-deposit', { bank: true });
        ctx.check('deposit: item moved to the bank', deposited && countOf(afterDeposit.bank, ITEM) === 1 && countOf(afterDeposit.inventory, ITEM) === 0, `bank ${ITEM}=${countOf(afterDeposit.bank, ITEM)} inventory ${ITEM}=${countOf(afterDeposit.inventory, ITEM)}`);
        await ctx.page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Bank.close());

        ctx.step('clean relog: the server bank must still hold the deposit');
        await ctx.relog();
        if (!ctx.check('bank reopens after relog', await openBank(ctx.page), 'Bank booth Use-quickly')) return;
        const relogBank = await ctx.snapshot('relog-bank', { bank: true });
        ctx.check('relog: deposit persisted', countOf(relogBank.bank, ITEM) === 1, `bank ${ITEM}=${countOf(relogBank.bank, ITEM)}`);
        const withdrawn = await bankMove(ctx.page, 'withdraw');
        const afterWithdraw = await ctx.snapshot('after-withdraw', { bank: true });
        ctx.check('withdraw: item back in the pack', withdrawn && countOf(afterWithdraw.inventory, ITEM) === 1 && countOf(afterWithdraw.bank, ITEM) === 0, `inventory ${ITEM}=${countOf(afterWithdraw.inventory, ITEM)} bank ${ITEM}=${countOf(afterWithdraw.bank, ITEM)}`);
        await ctx.page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Bank.close());

        if (!(await walkChecked(ctx, GENERAL_STORE, 3, 'bank to shop'))) return;
        ctx.step(`Shop.open('${SHOP_KEEPER}') then Shop.sell('${ITEM}', 1)`);
        if (!ctx.check('shop reopens', (await openShop(ctx.page)).open, SHOP_KEEPER)) return;
        const sold = await ctx.page.evaluate(item => (globalThis as never as Abi).__rs2b0t.Shop.sell(item, 1), ITEM);
        await ctx.page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Shop.close());
        const after = await ctx.snapshot('after', {});
        const refund = countOf(after.inventory, 'Coins') - countOf(afterBuy.inventory, 'Coins');
        ctx.check('sell: item gone for fewer coins than it cost', sold === 1 && countOf(after.inventory, ITEM) === 0 && refund > 0 && refund < price, `sold=${sold} refund=${refund} price=${price}`);

        ctx.step('clean relog: the login payload carries the server inventory');
        await ctx.relog();
        const relogged = await ctx.snapshot('after-relog', {});
        ctx.check('after relog: coins and pack persisted', countOf(relogged.inventory, 'Coins') === countOf(after.inventory, 'Coins') && countOf(relogged.inventory, ITEM) === 0, `coins=${countOf(relogged.inventory, 'Coins')} ${ITEM}=${countOf(relogged.inventory, ITEM)}`);
    }
});
