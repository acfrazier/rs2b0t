/* eslint-disable @typescript-eslint/no-explicit-any -- Game/Banking singletons are
   monkey-patched per test; typed shims would re-state the surface for no safety. */
import { afterEach, expect, test } from 'bun:test';
import { PeriodicBank } from '#/bot/api/tasks/PeriodicBank.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Game } from '#/bot/api/game/Game.js';
import { Execution } from '#/bot/api/execution/Execution.js';

function make(over: Partial<ConstructorParameters<typeof PeriodicBank>[0]> = {}) {
    return new PeriodicBank({
        strategy: () => 'items', itemsThreshold: () => 5, minutesThreshold: () => 999,
        countLoot: () => 10, deposit: () => true, ...over
    } as any);
}

const originals = { inCombat: Game.inCombat, bankNearest: Banking.bankNearest, delayTicks: Execution.delayTicks };
afterEach(() => {
    (Game as any).inCombat = originals.inCombat;
    (Banking as any).bankNearest = originals.bankNearest;
    (Execution as any).delayTicks = originals.delayTicks;
});

test('off strategy never validates', () => {
    expect(make({ strategy: () => 'off' }).validate()).toBe(false);
});
test('validates when the strategy trips and out of combat', () => {
    (Game as any).inCombat = () => false;
    expect(make().validate()).toBe(true);
});
test('never validates in combat', () => {
    (Game as any).inCombat = () => true;
    expect(make().validate()).toBe(false);
});
test('execute forwards the RAW own predicate + commonJunk=true (default) so bankNearest composes once', async () => {
    let called: any = null;
    (Banking as any).bankNearest = async (o: any) => { called = o; return true; };
    (Game as any).inCombat = () => false;
    const dep = (n: string) => n === 'mine';
    const task = make({ deposit: dep, returnTo: () => ({ x: 1, z: 2, level: 0 }) });
    await task.execute();
    expect(called.deposit('mine')).toBe(true);
    expect(called.deposit('uncut sapphire')).toBe(false);
    expect(called.deposit('rune scimitar')).toBe(false);
    expect(called.commonJunk).toBe(true);
    expect(called.returnTo).toEqual({ x: 1, z: 2, level: 0 });
});
test('execute forwards commonJunk=false so the junk opt-out reaches bankNearest', async () => {
    let called: any = null;
    (Banking as any).bankNearest = async (o: any) => { called = o; return true; };
    (Game as any).inCombat = () => false;
    const dep = (n: string) => n === 'mine';
    const task = make({ deposit: dep, commonJunk: () => false });
    await task.execute();
    expect(called.deposit('mine')).toBe(true);
    expect(called.deposit('uncut sapphire')).toBe(false);
    expect(called.commonJunk).toBe(false);
});
test('execute forwards the after-deposit bank hook', async () => {
    let called: any = null;
    (Banking as any).bankNearest = async (o: any) => { called = o; return true; };
    const afterDeposit = async () => {};
    await make({ afterDeposit }).execute();
    expect(called.afterDeposit).toBe(afterDeposit);
});
test('execute forwards an explicit bank destination', async () => {
    let called: any = null;
    (Banking as any).bankNearest = async (o: any) => { called = o; return true; };
    const destination = { name: 'Al Kharid', tile: { x: 3269, z: 3167, level: 0 } };
    await make({ destination: () => destination }).execute();
    expect(called.destination).toEqual(destination);
});
test('execute logs a durable completion marker after successful banking', async () => {
    const messages: string[] = [];
    (Banking as any).bankNearest = async () => true;
    await make({ log: message => messages.push(message) }).execute();
    expect(messages).toContain('periodic bank: completed');
});
test('backs off ALL strategies after a failed (unreachable-bank) attempt', async () => {
    (Banking as any).bankNearest = async () => false;
    (Game as any).inCombat = () => false;
    (Execution as any).delayTicks = async () => {};
    const task = make();
    expect(task.validate()).toBe(true);
    await task.execute();
    expect(task.validate()).toBe(false);
});

test('PeriodicBankOptions accepts a commonJunk getter (type-level + default include)', () => {
    const base = {
        strategy: () => 'off' as const, itemsThreshold: () => 1, minutesThreshold: () => 1,
        countLoot: () => 0, deposit: (_n: string) => false
    };
    expect(new PeriodicBank(base)).toBeDefined();
    expect(new PeriodicBank({ ...base, commonJunk: () => false })).toBeDefined();
});
