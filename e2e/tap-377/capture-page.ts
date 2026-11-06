import type { Page } from 'playwright-core';
import type { CheckpointState } from '../../tools/tap-377/format.js';

interface Player { routeX: number[]; routeZ: number[]; routeLength: number; username?: string }
interface CaptureClient {
    constructor: { loopCycle: number };
    ingame: boolean;
    sceneState: number;
    sceneInstanced?: boolean;
    mapBuildBaseX: number;
    mapBuildBaseZ: number;
    minusedlevel: number;
    localPlayer: Player | null;
    players: (Player | null)[];
    playerIds: number[];
    playerCount: number;
    mainModalId: number;
    chatModalId: number;
    sideModalId: number;
    chatbackInputOpen?: number;
    dialogInputOpen?: boolean;
    bankArrangeMode?: number;
    ptype: number;
    ptype0: number;
    stream: { available: number } | null;
    tcpIn?: () => Promise<boolean>;
    readPacket?: () => Promise<boolean>;
    login: (user: string, pass: string, reconnect: boolean) => Promise<void>;
    loginUser: string;
    loginPass: string;
    onDemand: { remaining(): number } | null;
    tryMove: (...args: (number | boolean)[]) => boolean;
}
export interface Npc { id: number; index: number; name: string | null; ops: (string | null)[] }
export interface Loc { id: number; name: string | null; x: number; z: number; lx: number; lz: number; ops: (string | null)[] }
export interface InvItem { id: number; slot: number; count: number; name: string | null; comId?: number }
interface Harness {
    client: CaptureClient;
    actions: Record<string, (...args: (string | number)[]) => boolean>;
    reader: Record<string, (...args: unknown[]) => unknown>;
}
interface Observer {
    inboundCount: number;
    tick: number;
    segment: number;
    foreignPlayer: boolean;
    packetFailure: boolean;
    state(): CaptureSnapshot;
}
interface CaptureWindow {
    __lc377?: Harness;
    rs2b0t?: Harness;
    __sessionObservation?: Observer;
}
export interface CaptureSnapshot {
    state: CheckpointState;
    cycle: number;
    inboundCount: number;
    tick: number;
    segment: number;
    moving: boolean;
    remaining: number;
    main: number;
    chat: number;
    side: number;
    countDialog: boolean;
    bankArrangeMode: number;
    foreignPlayer: boolean;
    packetFailure: boolean;
}

/** Observe the existing client. No client or harness bundle is changed. */
export async function installObserver(page: Page, prefix: string, playerInfoOpcode: number): Promise<void> {
    await page.waitForFunction(() => {
        const g = globalThis as unknown as CaptureWindow;
        const c = (g.__lc377 ?? g.rs2b0t)?.client;
        return c && c.constructor.loopCycle > 10;
    }, undefined, { timeout: 180_000 });
    await page.evaluate(({ accountPrefix, playerInfoOpcode }) => {
        const g = globalThis as unknown as CaptureWindow;
        const c = (g.__lc377 ?? g.rs2b0t)!.client;
        if (g.__sessionObservation) throw new Error('capture observer already installed');
        const o: Observer = {
            inboundCount: 0, tick: 0, segment: 0, foreignPlayer: false, packetFailure: false,
            state() {
                const p = c.localPlayer;
                return {
                    state: {
                        serverTile: { x: c.mapBuildBaseX + (p?.routeX[0] ?? 0), z: c.mapBuildBaseZ + (p?.routeZ[0] ?? 0), level: c.minusedlevel },
                        sceneState: c.sceneState, ingame: c.ingame, sceneInstanced: c.sceneInstanced === true,
                        mapBuildBaseX: c.mapBuildBaseX, mapBuildBaseZ: c.mapBuildBaseZ
                    },
                    cycle: c.constructor.loopCycle, inboundCount: o.inboundCount, tick: o.tick, segment: o.segment,
                    moving: (p?.routeLength ?? 0) > 0, remaining: c.onDemand?.remaining() ?? -1,
                    main: c.mainModalId, chat: c.chatModalId, side: c.sideModalId,
                    countDialog: c.chatbackInputOpen === 1 || c.dialogInputOpen === true, bankArrangeMode: c.bankArrangeMode ?? 0,
                    foreignPlayer: o.foreignPlayer, packetFailure: o.packetFailure
                };
            }
        };
        const method = c.tcpIn ? 'tcpIn' : 'readPacket';
        const original = c[method];
        if (!original) throw new Error('capture packet observer unavailable');
        c[method] = async function () {
            const ingame = c.ingame;
            let result: boolean;
            try { result = await original.call(c); }
            catch { o.packetFailure = true; throw new Error('capture observed a packet-handler failure'); }
            if (c.ptype === -1 && (result || (ingame && !c.ingame))) {
                o.inboundCount++;
                if (c.ptype0 === playerInfoOpcode) o.tick++;
            }
            for (let i = 0; i < c.playerCount; i++) {
                const name = c.players[c.playerIds[i]]?.username;
                if (name && !name.toLowerCase().replaceAll(' ', '').startsWith(accountPrefix.toLowerCase())) o.foreignPlayer = true;
            }
            return result;
        };
        const login = c.login;
        c.login = async function (user, pass, reconnect) {
            o.inboundCount = 0;
            o.tick = 0;
            o.segment++;
            return login.call(c, user, pass, reconnect);
        };
        g.__sessionObservation = o;
    }, { accountPrefix: prefix, playerInfoOpcode });
}

export async function observe(page: Page): Promise<CaptureSnapshot> {
    return page.evaluate(() => {
        const o = (globalThis as unknown as CaptureWindow).__sessionObservation;
        if (!o) throw new Error('capture observer missing');
        return o.state();
    });
}

export function sameQuiescentState(a: CaptureSnapshot, b: CaptureSnapshot): boolean {
    return a.state.ingame && b.state.ingame && a.state.sceneState === 2 && b.state.sceneState === 2 &&
        !a.moving && !b.moving && a.remaining === 0 && b.remaining === 0 &&
        a.state.serverTile.x === b.state.serverTile.x && a.state.serverTile.z === b.state.serverTile.z &&
        a.state.serverTile.level === b.state.serverTile.level &&
        a.state.mapBuildBaseX === b.state.mapBuildBaseX && a.state.mapBuildBaseZ === b.state.mapBuildBaseZ &&
        a.state.sceneInstanced === b.state.sceneInstanced && a.segment === b.segment;
}

export async function cycles(page: Page, count: number): Promise<void> {
    const start = (await observe(page)).cycle;
    await page.waitForFunction(({ start, count }) => {
        const o = (globalThis as unknown as CaptureWindow).__sessionObservation;
        return o && o.state().cycle - start >= count;
    }, { start, count }, { timeout: 15_000, polling: 20 });
}

export async function quiescent(page: Page, timeout = 60_000): Promise<CaptureSnapshot> {
    const deadline = Date.now() + timeout;
    let anchor = await observe(page);
    while (Date.now() < deadline) {
        await cycles(page, 1);
        const current = await observe(page);
        if (current.foreignPlayer) throw new Error('capture refused: a player outside the account prefix entered the scene');
        if (current.packetFailure) throw new Error('capture refused: packet handler failed');
        if (!sameQuiescentState(anchor, current)) anchor = current;
        else if (current.tick - anchor.tick >= 5) return current;
    }
    throw new Error('capture did not reach a quiescent built scene');
}

export async function login(page: Page, username: string, secret: string): Promise<void> {
    await page.evaluate(({ username, secret }) => {
        const c = ((globalThis as unknown as CaptureWindow).__lc377 ?? (globalThis as unknown as CaptureWindow).rs2b0t)!.client;
        c.loginUser = username;
        c.loginPass = secret;
        void c.login(username, secret, false);
    }, { username, secret });
    await page.waitForFunction(() => (globalThis as unknown as CaptureWindow).__sessionObservation?.state().state.ingame, undefined, { timeout: 120_000 });
    await quiescent(page);
}

export async function action(page: Page, name: string, ...args: (string | number)[]): Promise<void> {
    const ok = await page.evaluate(({ name, args }) => {
        const g = globalThis as unknown as CaptureWindow;
        const h = g.__lc377 ?? g.rs2b0t;
        const fn = h?.actions[name];
        if (!fn) throw new Error('capture action is unavailable');
        return fn(...args);
    }, { name, args });
    if (!ok) throw new Error(`capture action refused: ${name}`);
}

export async function readValue<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    return page.evaluate(({ name, args }) => {
        const g = globalThis as unknown as CaptureWindow;
        const fn = (g.__lc377 ?? g.rs2b0t)?.reader[name];
        if (!fn) throw new Error('capture reader is unavailable');
        return fn(...args);
    }, { name, args }) as Promise<T>;
}

export async function walk(page: Page, dx = 1, dz = 0): Promise<void> {
    const before = await quiescent(page);
    const sent = await page.evaluate(({ dx, dz }) => {
        const g = globalThis as unknown as CaptureWindow;
        const c = (g.__lc377 ?? g.rs2b0t)!.client;
        const p = c.localPlayer;
        if (!p || !c.ingame || c.sceneState !== 2) return false;
        return c.tryMove(p.routeX[0], p.routeZ[0], p.routeX[0] + dx, p.routeZ[0] + dz, false, 0, 0, 0, 0, 0, 0);
    }, { dx, dz });
    if (!sent) throw new Error('capture walk had no valid path');
    await page.waitForFunction(({ x, z }) => {
        const s = (globalThis as unknown as CaptureWindow).__sessionObservation?.state();
        return s?.state.serverTile.x === x && s.state.serverTile.z === z;
    }, { x: before.state.serverTile.x + dx, z: before.state.serverTile.z + dz }, { timeout: 20_000 });
    await quiescent(page);
}

export async function cleanLogout(page: Page): Promise<void> {
    await action(page, 'ifButton', 2458);
    await page.waitForFunction(() => {
        const s = (globalThis as unknown as CaptureWindow).__sessionObservation?.state();
        return s && !s.state.ingame;
    }, undefined, { timeout: 20_000 });
}
