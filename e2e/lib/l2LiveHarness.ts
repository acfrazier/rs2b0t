/** L2 377 live cells: fresh accounts, labelled setup cheats, and server readbacks before and after the product runs.
 *  Every cell uses one isolated client deployment and writes one receipt file under L2_LIVE_EVIDENCE_DIR. */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Browser, BrowserContext, Page } from 'playwright-core';

import { pressCleanLogout } from './cleanLogout.js';
import { deployIsolatedClient, launchBrowser, parseArgs, setSettings, type IsolatedClient } from './harness.js';
import { runNavWalk, teleArrive, type NavTile, type NavWalkResult } from './navLiveHarness.js';
import { cheatQuiet, mainlandAccount, relog } from '../tutorial/harness.js';

/** The L2 account prefix (Q10); the random part keeps the name at most nine characters. */
export const L2_ACCOUNT_PREFIX = 'frl2';
const SUFFIX_CHARS = 5;

export type L2Item = { name: string; count: number };

/** One readback. Every field comes from server-sent state: `getvar` replies, the player update tile, `UPDATE_INV_*` and `UPDATE_STAT`. */
export type L2Snapshot = {
    label: string;
    at: string;
    serverTile: NavTile | null;
    inventory: L2Item[];
    vars: Record<string, number | null>;
    xp: Record<string, number>;
    bank: L2Item[] | null;
};

export type L2SnapshotSpec = { vars?: readonly string[]; xp?: readonly string[]; bank?: boolean };

export type L2Check = { name: string; pass: boolean; detail: string };

/** One observed value change of a watched server var while a script ran (fresh `::getvar` replies). */
export type L2VarChange = { at: string; name: string; value: number | null };

export type L2ScriptResult = { state: string; stopReason: string | null; log: string[]; timedOut: boolean; timeline: L2VarChange[] };

export type L2RunOptions = {
    /** Start through ScriptRunner's explicit unqualified override; the receipt says so. */
    runUnqualified?: boolean;
    /** Server vars read while the script runs; every value change lands in the timeline. */
    watch?: readonly string[];
};

export type L2RunReceipt = {
    cell: string;
    run: number;
    user: string;
    freshSaveBeforeLogin: boolean;
    why: string;
    seeds: string[];
    steps: string[];
    snapshots: L2Snapshot[];
    checks: L2Check[];
    scriptLog: string[];
    walkLogs: string[];
    timeline: L2VarChange[];
    stalls: string[];
    consoleTail: string[];
    pass: boolean;
    failures: string[];
};

export interface L2RunContext {
    readonly page: Page;
    readonly user: string;
    readonly run: number;
    /** A labelled setup cheat on this account's own state. */
    seed(label: string): void;
    step(text: string): void;
    check(name: string, pass: boolean, detail: string): boolean;
    snapshot(label: string, spec: L2SnapshotSpec): Promise<L2Snapshot>;
    /** Clean logout and login, so the next snapshot reads the server's login payload. */
    relog(): Promise<void>;
    /** Engine cheat that seeds this account's own state; the label lands in the receipt. */
    cheat(command: string, label: string): Promise<void>;
    tele(tile: NavTile, label: string): Promise<void>;
    runScript(name: string, settings: Record<string, string | number | boolean>, timeoutMs: number, options?: L2RunOptions): Promise<L2ScriptResult>;
    /** A fresh `::getvar` reply from the server, or null when none arrives. */
    serverVar(name: string): Promise<number | null>;
    /** Product webwalk (`Traversal.walkTo`, walker teleports off); its log lands in the receipt. */
    walk(dest: NavTile, radius: number, label: string): Promise<NavWalkResult>;
}

export type L2Cell = {
    cell: string;
    why: string;
    receiptFile: string;
    execute(ctx: L2RunContext): Promise<void>;
};

type Abi = {
    rs2b0t: {
        runner: {
            state: string;
            ctx: { log: { msg: string }[]; stopReason?: string | null; state: string } | null;
            start(meta: unknown, options?: { runUnqualified?: boolean }): void;
            stop(reason: string): void;
        };
        registry: { get(name: string): unknown };
        reader: { serverTile(): NavTile | null; chat(n: number): { text: string }[] };
        client: { ingame: boolean; out: { p1Enc(op: number): void; p1(v: number): void; pjstr(s: string): void } };
        protocol?: { clientCheat: number };
    };
    __rs2b0t: {
        Inventory: { items(): { name: string | null; count: number }[] };
        Skills: { xp(name: string): number };
        Bank: { isOpen(): boolean; items(): { name: string | null; count: number }[] };
    };
};

function hasSavedAccount(engineDir: string, user: string): boolean {
    const profiles = path.join(engineDir, 'data', 'players');
    if (!existsSync(profiles)) return false;
    return readdirSync(profiles).some(profile => existsSync(path.join(profiles, profile, `${user}.sav`)));
}

/** A fresh `frl2` account name with no save under any engine profile. */
export function freshL2User(engineDir: string, used: Set<string>): string {
    for (let attempt = 0; attempt < 512; attempt++) {
        const user = `${L2_ACCOUNT_PREFIX}${randomBytes(3).toString('hex').slice(0, SUFFIX_CHARS)}`;
        if (!used.has(user) && !hasSavedAccount(engineDir, user)) {
            used.add(user);
            return user;
        }
    }
    throw new Error(`could not allocate a fresh ${L2_ACCOUNT_PREFIX} account name`);
}

/** Sum of `name` (case-insensitive) in a readback list. */
export function countOf(items: readonly L2Item[] | null, name: string): number {
    if (!items) return 0;
    const wanted = name.toLowerCase();
    return items.filter(item => item.name.toLowerCase() === wanted).reduce((sum, item) => sum + item.count, 0);
}

/** Send `::getvar name` and wait for a reply line that arrived after the send.
 *  Why: `getServerVarQuiet` reads the newest matching chat line, which is a stale reply when the new one is late; a stage proof needs the fresh one. */
export async function serverVar(page: Page, name: string): Promise<number | null> {
    return page.evaluate(async varName => {
        const g = globalThis as never as Abi;
        if (!g.rs2b0t.client.ingame) return null;
        const lines = (): string[] => g.rs2b0t.reader.chat(100).map(line => line.text);
        const before = lines();
        const command = `getvar ${varName}`;
        g.rs2b0t.client.out.p1Enc(g.rs2b0t.protocol?.clientCheat ?? 224);
        g.rs2b0t.client.out.p1(command.length + 1);
        g.rs2b0t.client.out.pjstr(command);
        const prefix = `get ${varName.toLowerCase()}:`;
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 100));
            const now = lines();
            // Index 0 is the newest line: the new lines are the shortest prefix whose removal leaves the old history.
            let added = 0;
            for (; added < now.length; added++) {
                let same = true;
                for (let i = added; i < now.length && same; i++) same = now[i] === before[i - added];
                if (same) break;
            }
            const reply = now.slice(0, added).find(text => text.toLowerCase().startsWith(prefix));
            if (reply !== undefined) {
                const value = parseInt(reply.slice(prefix.length).trim(), 10);
                return Number.isNaN(value) ? null : value;
            }
        }
        return null;
    }, name);
}

async function readSnapshot(page: Page, label: string, spec: L2SnapshotSpec): Promise<L2Snapshot> {
    const vars: Record<string, number | null> = {};
    for (const name of spec.vars ?? []) {
        let value: number | null = null;
        for (let attempt = 0; attempt < 3 && value === null; attempt++) value = await serverVar(page, name);
        vars[name] = value;
    }
    const state = await page.evaluate(
        ({ xpNames, bank }) => {
            const g = globalThis as never as Abi;
            const items = (list: { name: string | null; count: number }[]) => {
                const merged = new Map<string, number>();
                for (const item of list) {
                    if (item.name === null) continue;
                    merged.set(item.name, (merged.get(item.name) ?? 0) + item.count);
                }
                return [...merged].map(([name, count]) => ({ name, count }));
            };
            const xp: Record<string, number> = {};
            for (const name of xpNames) xp[name] = g.__rs2b0t.Skills.xp(name);
            return {
                serverTile: g.rs2b0t.reader.serverTile(),
                inventory: items(g.__rs2b0t.Inventory.items()),
                xp,
                bank: bank && g.__rs2b0t.Bank.isOpen() ? items(g.__rs2b0t.Bank.items()) : null
            };
        },
        { xpNames: [...(spec.xp ?? [])], bank: spec.bank === true }
    );
    return { label, at: new Date().toISOString(), vars, ...state };
}

async function runnerState(page: Page): Promise<string> {
    return page.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.state);
}

async function runScript(page: Page, name: string, settings: Record<string, string | number | boolean>, timeoutMs: number, options: L2RunOptions = {}): Promise<L2ScriptResult> {
    if (Object.keys(settings).length > 0) await setSettings(page, name, settings);
    await page.evaluate(
        ({ script, runUnqualified }) => {
            const g = globalThis as never as Abi;
            const meta = g.rs2b0t.registry.get(script);
            if (!meta) throw new Error(`script '${script}' is not registered`);
            // Why: a qualified script starts without the override, which proves the registry admits it on this revision.
            g.rs2b0t.runner.start(meta, runUnqualified ? { runUnqualified: true } : undefined);
        },
        { script: name, runUnqualified: options.runUnqualified === true }
    );
    const timeline: L2VarChange[] = [];
    const last = new Map<string, number | null>();
    const deadline = Date.now() + timeoutMs;
    let timedOut = true;
    let started = false;
    while (Date.now() < deadline) {
        const state = await runnerState(page);
        if (state === 'running' || state === 'paused' || state === 'stopping') started = true;
        if (started && (state === 'stopped' || state === 'crashed' || state === 'idle')) {
            timedOut = false;
            break;
        }
        for (const varName of options.watch ?? []) {
            const value = await serverVar(page, varName);
            if (value !== null && last.get(varName) !== value) {
                last.set(varName, value);
                timeline.push({ at: new Date().toISOString(), name: varName, value });
                console.log(`  WATCH ${varName}=${value}`);
            }
        }
        await page.waitForTimeout(options.watch?.length ? 250 : 1000);
    }
    if (timedOut) {
        await page.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.stop('L2 cell timeout')).catch(() => undefined);
        await page.waitForTimeout(1500);
    }
    const out = await page.evaluate(() => {
        const runner = (globalThis as never as Abi).rs2b0t.runner;
        return { state: runner.state, stopReason: runner.ctx?.stopReason ?? null, log: runner.ctx?.log.map(row => row.msg) ?? [] };
    });
    return { ...out, timedOut, timeline };
}

/** Walker stall lines (known nav issue: phantom stair landings stall six ticks before a repath). */
export function stallLines(lines: readonly string[]): string[] {
    return lines.filter(line => /stuck at \(|stalled with no path-corridor/i.test(line));
}

/** Run `cell` L2_LIVE_RUNS times (default 3) on fresh accounts and write its receipt. Sets the exit code. */
export async function runL2Cell(cell: L2Cell): Promise<void> {
    const runs = Number(process.env.L2_LIVE_RUNS ?? 3);
    if (!Number.isInteger(runs) || runs < 1) throw new Error('L2_LIVE_RUNS must be a positive integer');
    const evidenceDir = process.env.L2_LIVE_EVIDENCE_DIR;
    const engineDir = process.env.ENGINE_DIR;
    if (!evidenceDir) throw new Error('set L2_LIVE_EVIDENCE_DIR to the private evidence directory');
    if (!engineDir) throw new Error('set ENGINE_DIR to the engine serving this run');
    const { base } = parseArgs(process.argv.slice(2), { base: process.env.BASE ?? 'http://localhost:81' });

    const receipts: L2RunReceipt[] = [];
    const used = new Set<string>();
    let deployment: IsolatedClient | undefined;
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let fatal: string | null = null;
    let deployPage: string | null = null;

    try {
        deployment = deployIsolatedClient(`${cell.cell}-${process.pid}-${Date.now().toString(36)}`, engineDir, 'out', { seedHtml: true });
        deployPage = deployment.page;
        browser = await launchBrowser({ swiftshader: true });
        context = await browser.newContext();

        for (let run = 1; run <= runs; run++) {
            const user = freshL2User(engineDir, used);
            const page = await context.newPage();
            const consoleLines: string[] = [];
            page.on('console', message => {
                consoleLines.push(message.text());
                if (consoleLines.length > 4000) consoleLines.shift();
            });
            const receipt: L2RunReceipt = {
                cell: cell.cell,
                run,
                user,
                freshSaveBeforeLogin: true,
                why: cell.why,
                seeds: ['new account; mainlandAccount tele-seeds off Tutorial Island, sets tutorial=1000, and clean-relogs to unlock the main world'],
                steps: [],
                snapshots: [],
                checks: [],
                scriptLog: [],
                walkLogs: [],
                timeline: [],
                stalls: [],
                consoleTail: [],
                pass: false,
                failures: []
            };
            const ctx: L2RunContext = {
                page,
                user,
                run,
                seed: label => {
                    receipt.seeds.push(label);
                    console.log(`  SEED ${label}`);
                },
                step: text => {
                    receipt.steps.push(text);
                    console.log(`  STEP ${text}`);
                },
                check: (name, pass, detail) => {
                    receipt.checks.push({ name, pass, detail });
                    console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
                    return pass;
                },
                snapshot: async (label, spec) => {
                    const snap = await readSnapshot(page, label, spec);
                    receipt.snapshots.push(snap);
                    console.log(`  READBACK ${label}: ${JSON.stringify({ tile: snap.serverTile, vars: snap.vars, xp: snap.xp, inventory: snap.inventory, bank: snap.bank })}`);
                    return snap;
                },
                relog: () => relog(page, user),
                cheat: async (command, label) => {
                    if (!(await cheatQuiet(page, command))) throw new Error(`cheat '${command}' not sent (not ingame?)`);
                    ctx.seed(`${label} (::${command})`);
                },
                tele: async (tile, label) => {
                    await teleArrive(page, tile, 3);
                    ctx.seed(`${label}: position tele-seeded to ${tile.x},${tile.z},L${tile.level}`);
                },
                runScript: async (name, settings, timeoutMs, options) => {
                    if (options?.runUnqualified) ctx.step(`start ${name} through the explicit runUnqualified override: its registry revision is not this client's`);
                    const result = await runScript(page, name, settings, timeoutMs, options);
                    receipt.scriptLog.push(...result.log);
                    receipt.timeline.push(...result.timeline);
                    return result;
                },
                serverVar: name => serverVar(page, name),
                walk: async (dest, radius, label) => {
                    ctx.step(`walk ${label} to ${dest.x},${dest.z},L${dest.level} (radius ${radius}, walker teleports off)`);
                    const result = await runNavWalk(page, {
                        dest,
                        budgetMs: 240_000,
                        radius,
                        useTeleports: false,
                        distanceBeforeTeleport: 0,
                        pollMs: 1000,
                        progressEverySec: 30,
                        resultKey: '__l2Walk',
                        scriptNamePrefix: 'L2Walk'
                    });
                    receipt.walkLogs.push(`-- ${label}`, ...result.logs);
                    return result;
                }
            };
            console.log(`STEP cell=${cell.cell} run=${run}/${runs} account=${user}`);
            console.log(`WHY ${cell.why}`);
            try {
                await mainlandAccount(page, base, user, deployment.page);
                await cell.execute(ctx);
            } catch (error) {
                receipt.failures.push(error instanceof Error ? error.message : String(error));
            } finally {
                receipt.stalls = stallLines([...receipt.scriptLog, ...receipt.walkLogs, ...consoleLines]);
                receipt.consoleTail = consoleLines.slice(-200);
                const failedChecks = receipt.checks.filter(check => !check.pass).map(check => `${check.name}: ${check.detail}`);
                receipt.failures.push(...failedChecks);
                const labels = new Set(receipt.snapshots.map(snap => snap.label));
                for (const required of ['before', 'after']) {
                    if (!labels.has(required)) receipt.failures.push(`missing '${required}' server readback`);
                }
                receipt.pass = receipt.failures.length === 0 && receipt.checks.length > 0;
                receipts.push(receipt);
                console.log(`${receipt.pass ? 'PASS' : 'FAIL'} cell=${cell.cell} run=${run}/${runs} account=${user}${receipt.failures.length ? ` failures=${receipt.failures.join('; ')}` : ''}`);
                if (receipt.stalls.length) console.log(`  walker stalls: ${receipt.stalls.join(' | ')}`);
                await pressCleanLogout(page).catch(error => console.error(`logout ${user}: ${error instanceof Error ? error.message : String(error)}`));
                await page.close().catch(() => undefined);
            }
        }
    } catch (error) {
        fatal = error instanceof Error ? error.message : String(error);
        console.error(`FATAL L2 cell ${cell.cell}: ${fatal}`);
    } finally {
        await context?.close().catch(() => undefined);
        await browser?.close().catch(() => undefined);
        deployment?.cleanup();
        mkdirSync(evidenceDir, { recursive: true });
        const receiptPath = path.join(evidenceDir, cell.receiptFile);
        writeFileSync(receiptPath, `${JSON.stringify({ cell: cell.cell, base, deployPage, fatal, createdAt: new Date().toISOString(), runs: receipts }, null, 2)}\n`);
        console.log(`receipt=${receiptPath}`);
    }
    const passes = receipts.filter(receipt => receipt.pass).length;
    if (fatal || receipts.length !== runs || passes !== runs) process.exitCode = 1;
    console.log(`L2 ${cell.cell} summary ${passes}/${runs} pass`);
}
