/** L2 377 template cell: a dialogue with options through ChatDialog, Baraek's fur trade in Varrock square.
 *  Content cb6cc5ea1: baraek.rs2:17-18 (two options without fur), :21-49 (buy at 20 coins: inv_del coins 20, inv_add fur 1),
 *  :15-16 (third option once a fur is held), :59-75 (sell at 12 coins each); _unpack/377/all.obj:12157-12158 (obj `fur` is named Bear fur);
 *  maps/m50_53.jm2 NPC `0 18 43: 547` (Baraek at 3218,3435).
 *  Run with ENGINE_DIR and L2_LIVE_EVIDENCE_DIR set; three fresh accounts by default (L2_LIVE_RUNS). */
import type { Page } from 'playwright-core';

import { countOf, runL2Cell, type L2RunContext } from './lib/l2LiveHarness.js';

const COINS = 30;
const BUY_PRICE = 20;
const SELL_PRICE = 12;
const FUR = 'Bear fur';
const VARROCK_SQUARE = { x: 3217, z: 3433, level: 0 };

const SELL_ME_FURS = 'Can you sell me some furs?';
const QUEST = 'Hello. I am in search of a quest.';
const BUY_MY_FUR = 'Would you like to buy my fur?';
const ACCEPT_BUY = 'Yeah, Okay, here you go.';
const REFUSE_BUY = '20 gold coins? That\'s an outrage!';
const ACCEPT_SELL = 'OK, here you go.';
const REFUSE_SELL = 'No thanks, I\'ll leave it.';

type Menu = { offered: string[]; chose: string };
type Conversation = { started: boolean; menus: Menu[]; pages: number; error: string | null };

type Abi = {
    __rs2b0t: {
        Npcs: { query(): { name(n: string): { action(a: string): { nearest(): { interact(op: string): Promise<boolean> } | null } } } };
        ChatDialog: {
            isOpen(): boolean;
            canContinue(): boolean;
            options(): string[];
            continue(): Promise<boolean>;
            chooseOption(match?: string): Promise<boolean>;
        };
        Execution: { delayUntil(condition: () => boolean, timeout: number): Promise<boolean>; delayTicks(n: number): Promise<void> };
    };
};

/** Talk to Baraek and answer each option menu with the next scripted choice; a menu that does not offer exactly `expected` fails. */
async function converse(page: Page, menus: { expected: string[]; choose: string }[]): Promise<Conversation> {
    return page.evaluate(async plan => {
        const g = (globalThis as never as Abi).__rs2b0t;
        const out: Conversation = { started: false, menus: [], pages: 0, error: null };
        const npc = g.Npcs.query().name('Baraek').action('Talk-to').nearest();
        if (!npc || !(await npc.interact('Talk-to'))) {
            out.error = 'no Baraek with Talk-to in the scene';
            return out;
        }
        out.started = await g.Execution.delayUntil(() => g.ChatDialog.isOpen(), 15_000);
        if (!out.started) {
            out.error = 'dialogue never opened';
            return out;
        }
        let quiet = 0;
        for (let i = 0; i < 80 && quiet < 6; i++) {
            const offered = g.ChatDialog.options();
            if (offered.length > 0) {
                const next = plan[out.menus.length];
                if (!next) {
                    out.error = `unexpected menu ${JSON.stringify(offered)}`;
                    return out;
                }
                const same = offered.length === next.expected.length && offered.every((text, index) => text === next.expected[index]);
                out.menus.push({ offered, chose: next.choose });
                if (!same) {
                    out.error = `menu ${out.menus.length} offered ${JSON.stringify(offered)}, expected ${JSON.stringify(next.expected)}`;
                    return out;
                }
                if (!(await g.ChatDialog.chooseOption(next.choose))) {
                    out.error = `could not choose '${next.choose}'`;
                    return out;
                }
                quiet = 0;
            } else if (g.ChatDialog.canContinue()) {
                await g.ChatDialog.continue();
                out.pages++;
                quiet = 0;
            } else {
                quiet = g.ChatDialog.isOpen() ? 0 : quiet + 1;
                await g.Execution.delayTicks(1);
            }
        }
        if (out.menus.length !== plan.length) out.error = `answered ${out.menus.length} of ${plan.length} menus`;
        return out;
    }, menus);
}

function recordConversation(ctx: L2RunContext, label: string, talk: Conversation, menus: number): boolean {
    ctx.step(`${label}: ${JSON.stringify(talk.menus)} pages=${talk.pages}`);
    return ctx.check(`${label}: options offered and chosen`, talk.error === null && talk.menus.length === menus, talk.error ?? `${talk.menus.length} menus`);
}

await runL2Cell({
    cell: 'dialogue',
    receiptFile: 'l2-dialogue-receipts.json',
    why: 'talk to Baraek twice through ChatDialog: buy a fur for 20 coins, then sell it back for 12; each menu must offer the content option text exactly, and the server inventory is read before, between, after and after a relog',
    execute: async ctx => {
        await ctx.cheat(`give coins ${COINS}`, `inventory seeded with ${COINS} coins on this account`);
        await ctx.tele(VARROCK_SQUARE, 'fixture start in Varrock square beside Baraek');
        const before = await ctx.snapshot('before', {});
        ctx.check('before: coins and no fur', countOf(before.inventory, 'Coins') === COINS && countOf(before.inventory, FUR) === 0, `coins=${countOf(before.inventory, 'Coins')} fur=${countOf(before.inventory, FUR)}`);

        const buy = await converse(ctx.page, [
            { expected: [SELL_ME_FURS, QUEST], choose: SELL_ME_FURS },
            { expected: [ACCEPT_BUY, REFUSE_BUY], choose: ACCEPT_BUY }
        ]);
        if (!recordConversation(ctx, 'buy conversation', buy, 2)) return;
        const bought = await ctx.snapshot('after-buy', {});
        ctx.check('buy: server took 20 coins and gave a fur', countOf(bought.inventory, 'Coins') === COINS - BUY_PRICE && countOf(bought.inventory, FUR) === 1, `coins=${countOf(bought.inventory, 'Coins')} fur=${countOf(bought.inventory, FUR)}`);

        const sell = await converse(ctx.page, [
            { expected: [SELL_ME_FURS, QUEST, BUY_MY_FUR], choose: BUY_MY_FUR },
            { expected: [ACCEPT_SELL, REFUSE_SELL], choose: ACCEPT_SELL }
        ]);
        if (!recordConversation(ctx, 'sell conversation', sell, 2)) return;
        const after = await ctx.snapshot('after', {});
        const expected = COINS - BUY_PRICE + SELL_PRICE;
        ctx.check('sell: server took the fur and paid 12 coins', countOf(after.inventory, 'Coins') === expected && countOf(after.inventory, FUR) === 0, `coins=${countOf(after.inventory, 'Coins')} expected=${expected} fur=${countOf(after.inventory, FUR)}`);

        ctx.step('clean relog: the login payload carries the server inventory');
        await ctx.relog();
        const relogged = await ctx.snapshot('after-relog', {});
        ctx.check('after relog: inventory persisted', countOf(relogged.inventory, 'Coins') === expected && countOf(relogged.inventory, FUR) === 0, `coins=${countOf(relogged.inventory, 'Coins')} fur=${countOf(relogged.inventory, FUR)}`);
    }
});
