import type { Page } from 'playwright-core';
import { action, cleanLogout, cycles, login, observe, quiescent, readValue, walk, type CaptureSnapshot, type Npc, type Loc, type InvItem } from './capture-page.js';
import type { Protocol, RecordingRecord } from '../../tools/tap-377/format.js';

export type Scenario = 'reference' | 'tutorial' | 'mainland' | 'instance';
export interface ScenarioContext {
    page: Page;
    username: string;
    secret: string;
    checkpoint(label: string): Promise<void>;
    note(label: string, details?: Record<string, unknown>): void;
    mainlandAccount?: (page: Page, username: string, secret: string) => Promise<unknown>;
}

async function until(page: Page, label: string, predicate: (state: CaptureSnapshot) => boolean | Promise<boolean>, timeout = 30_000): Promise<CaptureSnapshot> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const state = await observe(page);
        if (state.foreignPlayer || state.packetFailure) throw new Error('capture observed an unsafe or failed session');
        if (await predicate(state)) return state;
        await cycles(page, 1);
    }
    throw new Error(`capture assertion timed out: ${label}`);
}

async function seed(context: ScenarioContext, command: string): Promise<void> {
    context.note('seed', { command, scope: 'own account; not the transition under test' });
    await action(context.page, 'cheat', command);
    await cycles(context.page, 30);
    await quiescent(context.page);
}

interface Dialogue { body: string; options: { comId: number; text: string }[]; next: number | null; open: boolean }
async function dialogue(page: Page): Promise<Dialogue> {
    const [body, options, next, open] = await Promise.all([
        readValue<string>(page, 'chatBodyText'), readValue<Dialogue['options']>(page, 'chatOptions'),
        readValue<number | null>(page, 'chatContinueComId'), readValue<boolean>(page, 'dialogOpen')
    ]);
    return { body, options, next, open };
}

/** Only choose explicitly named options. An unexpected branch is a failed capture. */
async function advanceDialogue(context: ScenarioContext, choice: RegExp, done: (state: CaptureSnapshot) => boolean, stopAfter?: RegExp): Promise<void> {
    for (let transition = 0; transition < 40; transition++) {
        const state = await observe(context.page);
        if (done(state)) return;
        let current = await dialogue(context.page);
        if (!current.open) {
            await until(context.page, 'dialogue appeared', async s => done(s) || (await dialogue(context.page)).open);
            if (done(await observe(context.page))) return;
            current = await dialogue(context.page);
        }
        context.note('dialogue', { body: current.body, options: current.options.map(option => option.text) });
        if (current.options.length) {
            const options = current.options.filter(option => choice.test(option.text));
            if (options.length !== 1) throw new Error('capture dialogue has no unique approved option');
            await action(context.page, 'ifButton', options[0].comId);
        } else if (current.next !== null && current.next >= 0) {
            await action(context.page, 'continueDialog');
            if (stopAfter?.test(current.body)) return;
        } else throw new Error('capture dialogue has no continuation');
        const previous = JSON.stringify(current);
        await until(context.page, 'dialogue advanced', async s => done(s) || JSON.stringify(await dialogue(context.page)) !== previous);
    }
    throw new Error('capture dialogue exceeded its transition bound');
}

async function relog(context: ScenarioContext): Promise<void> {
    await context.checkpoint('before-logout');
    await cleanLogout(context.page);
    context.note('clean-logout');
    await login(context.page, context.username, context.secret);
    await context.checkpoint('relogin-built-scene');
    await cleanLogout(context.page);
    context.note('clean-final-logout');
}

async function reference(context: ScenarioContext): Promise<void> {
    await login(context.page, context.username, context.secret);
    await context.checkpoint('login-built-scene');
    const before = (await observe(context.page)).state.serverTile;
    await walk(context.page);
    await context.checkpoint('walk-built-scene');
    context.note('walk', { before, after: (await observe(context.page)).state.serverTile });
    await relog(context);
}

async function tutorial(context: ScenarioContext): Promise<void> {
    await login(context.page, context.username, context.secret);
    if ((await observe(context.page)).main === 3559) {
        await action(context.page, 'designAccept');
        await until(context.page, 'appearance accepted', state => state.main !== 3559);
    }
    await context.checkpoint('tutorial-login-built-scene');
    const before = (await observe(context.page)).state.serverTile;
    await walk(context.page);
    await context.checkpoint('tutorial-walk-built-scene');
    context.note('walk', { before, after: (await observe(context.page)).state.serverTile });
    const guide = (await readValue<Npc[]>(context.page, 'npcs')).find(npc => npc.name === 'RuneScape Guide');
    if (!guide) throw new Error('tutorial guide is absent');
    await action(context.page, 'npcOp', guide.index, 1);
    await until(context.page, 'tutorial dialogue appeared', async () => (await dialogue(context.page)).open);
    context.note('tutorial-talk', { body: (await dialogue(context.page)).body });
    await context.checkpoint('tutorial-talk-built-scene');
    await action(context.page, 'closeModal');
    await relog(context);
}

/** Main interface origin (4,4), bank layer (37,55), inventory (38,3), 32px slots and (15,6) margins. */
export function bankSlotPoint(slot: number): { x: number; y: number } {
    if (!Number.isInteger(slot) || slot < 0 || slot >= 8) throw new Error('capture bank drag requires a visible first-row slot');
    return { x: 95 + slot * 47, y: 78 };
}

export function rearranged(items: readonly number[], from: number, to: number, insert: boolean): number[] {
    const result = [...items];
    if (insert) result.splice(to, 0, result.splice(from, 1)[0]);
    else [result[from], result[to]] = [result[to], result[from]];
    return result;
}

async function drag(context: ScenarioContext, from: number, to: number, insert: boolean): Promise<void> {
    const before = await readValue<InvItem[]>(context.page, 'ifInv', 5382);
    if (!before.find(item => item.slot === from) || !before.find(item => item.slot === to)) throw new Error('capture drag requires occupied source and destination');
    await action(context.page, 'ifButton', insert ? 8131 : 8130);
    await until(context.page, 'bank rearrange mode', state => state.bankArrangeMode === (insert ? 1 : 0));
    const canvas = context.page.locator('#canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('capture canvas has no bounds');
    const size = await canvas.evaluate(element => {
        if (!(element instanceof HTMLCanvasElement)) throw new Error('capture surface is not a canvas');
        return { width: element.width, height: element.height };
    });
    const point = (slot: number) => {
        const p = bankSlotPoint(slot);
        return { x: box.x + p.x * box.width / size.width, y: box.y + p.y * box.height / size.height };
    };
    const source = point(from), target = point(to);
    const count = (await observe(context.page)).inboundCount;
    await context.page.mouse.move(source.x, source.y);
    await context.page.mouse.down();
    try {
        await cycles(context.page, 6);
        await context.page.mouse.move(target.x, target.y, { steps: 5 });
        await cycles(context.page, 2);
    } finally { await context.page.mouse.up(); }
    const ids = before.filter(item => item.slot < 5).sort((a, b) => a.slot - b.slot).map(item => item.id);
    const expected = rearranged(ids, from, to, insert);
    await until(context.page, 'server bank reorder', async state => {
        if (state.inboundCount <= count) return false;
        const current = await readValue<InvItem[]>(context.page, 'ifInv', 5382);
        return expected.every((id, slot) => current.find(item => item.slot === slot)?.id === id);
    });
    context.note(insert ? 'bank-insert' : 'bank-swap', { from, to, before: ids, after: expected });
    await context.checkpoint(insert ? 'bank-insert-built-scene' : 'bank-swap-built-scene');
}

async function mainland(context: ScenarioContext): Promise<void> {
    if (!context.mainlandAccount) throw new Error('mainland capture requires the approved account helper');
    context.note('seed', { command: 'mainlandAccount: own tutorial completion and mainland teleport, then relogin', scope: 'fixture preparation only' });
    await context.mainlandAccount(context.page, context.username, context.secret);
    await context.checkpoint('mainland-login-built-scene');
    await seed(context, 'tele 3212 3246 0');
    const doors = await readValue<Loc[]>(context.page, 'locs', { name: 'Door', maxDist: 10 });
    const door = doors.find(loc => loc.ops.includes('Open'));
    if (!door) throw new Error('mainland fixture has no nearby closed door');
    await action(context.page, 'opLocAt', door.x, door.z, 'Open');
    await until(context.page, 'door opened', async () => {
        const locs = await readValue<Loc[]>(context.page, 'locs', { name: 'Door', maxDist: 12 });
        return !locs.some(loc => loc.x === door.x && loc.z === door.z && loc.id === door.id && loc.ops.includes('Open'));
    });
    context.note('door-open', { id: door.id, x: door.x, z: door.z });
    await context.checkpoint('door-built-scene');
    await seed(context, 'tele 3205 3209 0');
    await action(context.page, 'opLocAt', 3204, 3207, 'Climb-up');
    await until(context.page, 'stairs changed level', state => state.state.serverTile.level === 1);
    await context.checkpoint('stairs-built-scene');
    await seed(context, 'tele 3212 3246 0');
    const shopkeeper = (await readValue<Npc[]>(context.page, 'npcs')).find(npc => npc.name === 'Shop keeper');
    if (!shopkeeper) throw new Error('mainland shopkeeper is absent');
    await action(context.page, 'npcOp', shopkeeper.index, 1);
    await advanceDialogue(context, /^Yes please\. What are you selling\?$/i, state => state.main === 3824);
    const stock = await readValue<InvItem[]>(context.page, 'ifInv', 3900);
    if (!stock.length) throw new Error('shop opened without stock');
    context.note('shop-open', { root: 3824, stockSlots: stock.length });
    await context.checkpoint('shop-built-scene');
    await action(context.page, 'closeModal');
    for (const [name, count] of [['coins', 100], ['pot', 1], ['bucket', 1], ['jug', 1], ['tinderbox', 1]] as const) await seed(context, `~bankitem ${name} ${count}`);
    await seed(context, 'tele 3093 3243 0');
    const banker = (await readValue<Npc[]>(context.page, 'npcs')).find(npc => npc.name === 'Banker' && npc.ops.includes('Bank'));
    if (!banker) throw new Error('mainland banker is absent');
    await action(context.page, 'npcOp', banker.index, banker.ops.indexOf('Bank') + 1);
    await until(context.page, 'bank opened', state => state.main === 5292 && state.side === 2005);
    await context.checkpoint('bank-built-scene');
    await drag(context, 0, 4, false);
    await drag(context, 4, 1, true);
    const coins = (await readValue<InvItem[]>(context.page, 'ifInv', 5382)).find(item => item.name?.toLowerCase() === 'coins');
    if (!coins || coins.count < 7) throw new Error('bank count-dialog fixture is absent');
    const before = (await readValue<InvItem[]>(context.page, 'ifInv', 2006)).find(item => item.id === coins.id)?.count ?? 0;
    await action(context.page, 'invButton', coins.id, coins.slot, 5382, 5);
    await until(context.page, 'count dialog appeared', state => state.countDialog);
    await action(context.page, 'resumeCountDialog', 7);
    await until(context.page, 'count dialog withdrew seven', async state => !state.countDialog &&
        (await readValue<InvItem[]>(context.page, 'ifInv', 2006)).some(item => item.id === coins.id && item.count === before + 7));
    context.note('count-dialog', { value: 7, object: coins.id });
    await context.checkpoint('count-dialog-built-scene');
    await action(context.page, 'closeModal');
    await until(context.page, 'bank closed', state => state.main === -1);
    await context.page.locator('#canvas').click({ position: { x: 250, y: 450 } });
    await context.page.keyboard.type('tap fixture');
    await context.page.keyboard.press('Enter');
    await cycles(context.page, 30);
    context.note('public-chat', { text: 'tap fixture' });
    await context.checkpoint('public-chat-built-scene');
    await relog(context);
}

async function instance(context: ScenarioContext): Promise<void> {
    if (!context.mainlandAccount) throw new Error('instance capture requires the approved account helper');
    context.note('seed', { command: 'mainlandAccount: own tutorial completion and mainland teleport, then relogin', scope: 'fixture preparation only' });
    await context.mainlandAccount(context.page, context.username, context.secret);
    for (const command of ['setvar spy 4', 'setvar druidquest 4', 'setvar recruitmentdrive 0', 'setvar rd_rooms_tempvar 0', 'setvar rd_rooms_tempvar2 0', 'tele 2996 3373 0']) await seed(context, command);
    await context.checkpoint('before-instance-built-scene');
    const tiffy = (await readValue<Npc[]>(context.page, 'npcs')).find(npc => npc.name === 'Sir Tiffy Cashien');
    if (!tiffy) throw new Error('instance entry NPC is absent');
    await action(context.page, 'npcOp', tiffy.index, 1);
    await advanceDialogue(context, /^Yes, let.s go[.!]?$/i, state => state.state.sceneInstanced && state.state.sceneState === 2, /Here we are! Best of luck/i);
    await until(context.page, 'instanced scene built', state => state.state.sceneInstanced && state.state.sceneState === 2, 60_000);
    const locs = await readValue<Loc[]>(context.page, 'locs', { maxDist: 30 });
    if (!locs.length) throw new Error('instance built without visible locs');
    context.note('instance-built', { locCount: locs.length, state: (await observe(context.page)).state });
    await context.checkpoint('instance-built-scene');
    await relog(context);
}

export async function captureScenario(scenario: Scenario, context: ScenarioContext): Promise<void> {
    if (scenario === 'reference') await reference(context);
    else if (scenario === 'tutorial') await tutorial(context);
    else if (scenario === 'mainland') await mainland(context);
    else await instance(context);
}

export function assertCaptureFrames(scenario: Scenario, records: readonly RecordingRecord[], protocol: Protocol): void {
    const inbound = new Map(protocol.server.map(packet => [packet.id, packet.name]));
    const outbound = new Map(protocol.client.map(packet => [packet.id, packet.name]));
    const counts = { in: new Map<string, number>(), out: new Map<string, number>() };
    const drags: string[] = [];
    let logins = 0, logouts = 0;
    for (const record of records) {
        if (record.type === 'login') {
            if (record.reconnect) throw new Error('capture has an unexpected reconnect');
            logins++;
        } else if (record.type === 'end') {
            if (record.reason !== 'logout') throw new Error('capture has an unclean segment end');
            logouts++;
        } else if (record.type === 'frame') {
            const name = (record.direction === 'in' ? inbound : outbound).get(parseInt(record.bytes.slice(0, 2), 16));
            if (!name) throw new Error('capture has an unknown opcode');
            const direction = counts[record.direction];
            direction.set(name, (direction.get(name) ?? 0) + 1);
            if (record.direction === 'out' && name === 'INV_BUTTOND') drags.push(record.bytes.slice(2));
        }
    }
    if (logins < 2 || logouts !== logins || (counts.in.get('LOGOUT') ?? 0) !== logouts) throw new Error('capture lacks a clean logout and relogin');
    const requirePackets = (direction: 'in' | 'out', names: string[]) => {
        for (const name of names) if (!counts[direction].has(name)) throw new Error(`capture lacks required ${direction} packet ${name}`);
    };
    requirePackets('in', ['PLAYER_INFO', 'REBUILD_NORMAL', 'LOGOUT']);
    requirePackets('out', ['IF_BUTTON']);
    if (scenario === 'reference' || scenario === 'tutorial') requirePackets('out', ['MOVE_GAMECLICK']);
    if (scenario !== 'reference') requirePackets('out', ['OPNPC1']);
    if (scenario === 'instance') requirePackets('in', ['REBUILD_REGION']);
    if (scenario === 'mainland') {
        requirePackets('in', ['P_COUNTDIALOG', 'IF_OPENMAIN_SIDE', 'UPDATE_INV_FULL']);
        requirePackets('out', ['RESUME_PAUSEBUTTON', 'INV_BUTTON5', 'RESUME_P_COUNTDIALOG', 'INV_BUTTOND', 'MESSAGE_PUBLIC']);
        const locOps = [...counts.out].filter(([name]) => /^OPLOC[1-5]$/.test(name)).reduce((sum, [, count]) => sum + count, 0);
        if (locOps < 2) throw new Error('capture lacks the door and stair operations');
        // Java 377 Client: p2_alt3(to), p1_alt1(mode), p2_alt2(component), p2_alt1(from).
        // Component 5382; swap 0→4 and insert 4→1. These are independent byte constants, not a production writer round-trip.
        if (!drags.includes('84008015860000') || !drags.includes('81008115860400')) throw new Error('capture lacks the two expected bank drag encodings');
    }
}
