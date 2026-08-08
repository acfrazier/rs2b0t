/**
 * Live walk stress over **every** travel OD scraped from clues, gathering, and quests.
 *
 * Corpus: `tools/nav/script-travel-corpus.ts` (CLUE_DB, gather catalogs, quest areas.ts).
 *
 * Segments (SEGMENT=…):
 *   all | clues | quests | gathering-all | fishing | mining | woodcutting
 *   | firemaking | cooking
 *
 *   ~/redeploy.sh
 *   HEADED=1 SEGMENT=fishing LIMIT=0 bun tools/nav-script-travel-live.ts
 *   HEADED=1 SEGMENT=clues LIMIT=20 BUDGET_S=300 bun tools/nav-script-travel-live.ts
 *   HEADED=1 SEGMENT=quests OFFSET=0 LIMIT=50 bun tools/nav-script-travel-live.ts
 *   HEADED=1 SEGMENT=gathering-all bun tools/nav-script-travel-live.ts
 *
 * Startup uses clean **IF_BUTTON logout** (com 2458 → ClientProt.IF_BUTTON=9) after
 * tutorial varps so mainlandAccount relogs in ~9s instead of a long unclean hold.
 * See tools/tutorial/harness.ts mainlandAccount + relog.
 *
 * LIMIT=0 → all legs in the segment (default 25 for safety).
 * OFFSET=N skips the first N legs (chunk long segments).
 * USE_TELEPORTS=0 pure-walk. ENERGY_REFILL_AT=25 mid-walk energy.
 */
import type { Page } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

import { launchBrowser, parseArgs, setSettings } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs, relog } from './tutorial/harness.js';
import {
    TRAVEL_SEGMENTS,
    buildTravelRoutes,
    filterTravelRoutes,
    travelRouteStats,
    type TravelRoute,
    type TravelSegment
} from './nav/script-travel-corpus.js';
import {
    transportQuestJournalNames,
    transportQuestSetvarCommands
} from '../src/bot/nav/transportQuestReqs.js';

const TICK_MS = 300;
const TICK_RESTORE_MS = 600;
const BUDGET_MS = (Number(process.env.BUDGET_S) || 240) * 1000;
const OFFSET = Math.max(0, Number(process.env.OFFSET) || 0);
/** LIMIT=0 means full segment (after OFFSET). Default 25 for safety. */
const LIVE_LIMIT_RAW = process.env.LIMIT;
const LIVE_LIMIT =
    LIVE_LIMIT_RAW === undefined || LIVE_LIMIT_RAW === ''
        ? 25
        : Number(LIVE_LIMIT_RAW);
const USE_TELEPORTS = process.env.USE_TELEPORTS !== '0' && process.env.USE_TELEPORTS !== 'false';
const PATH_PAINT = process.env.PATH_PAINT !== '0' && process.env.PATH_PAINT !== 'false';
const ENERGY_REFILL_AT = Number(process.env.ENERGY_REFILL_AT ?? 25);
const ARRIVAL = 8;
const SEED_QUESTS =
    process.env.SEED_QUESTS === '1'
    || process.env.SEED_QUESTS === 'true'
    || process.env.SEGMENT === 'quests';

const segmentRaw = (process.env.SEGMENT ?? 'all').toLowerCase() as TravelSegment;
const SEGMENT: TravelSegment = TRAVEL_SEGMENTS.includes(segmentRaw) ? segmentRaw : 'all';

const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890'
});

const proof = createHarnessProof({ issue: 0, slug: `nav-script-travel-${SEGMENT}` });

type Tile = { x: number; z: number; level: number };

type Abi = {
    __rs2b0t: {
        reader: {
            worldTile(): Tile | null;
            chat(n: number): { text: string }[];
            energy(): number;
        };
        Game: { energy(): number };
        LoopingBot: new () => { loop(): unknown; log(m: string): void };
        Traversal: {
            walkTo(
                dest: Tile,
                opts: {
                    radius?: number;
                    timeoutMs?: number;
                    log?: (m: string) => void;
                    useTeleportCatalog?: boolean;
                    policy?: { useTeleports?: boolean; distanceBeforeTeleport?: number };
                }
            ): Promise<boolean>;
        };
        SettingsStore: { save(name: string, key: string, raw: string): void };
        registerScript(m: { name: string; create(): unknown }): unknown;
    };
    rs2b0t: { runner: { state: string; start(meta: unknown): void; stop(): void } };
    __navTravel?: { walkOk: boolean; tile: Tile | null; logs: string[] };
};

function cheb(a: Tile, b: Tile): number {
    if (a.level !== b.level) {
        return 9999;
    }
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

function teleCmd(t: Tile): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

async function teleArrive(page: Page, spot: Tile, maxDist = 12): Promise<void> {
    for (let a = 0; a < 6; a++) {
        await cheatQuiet(page, teleCmd(spot));
        for (let p = 0; p < 16; p++) {
            const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            if (t && cheb(t, spot) <= maxDist) {
                await page.waitForTimeout(300);
                return;
            }
            await page.waitForTimeout(150);
        }
    }
    throw new Error(`tele to ${spot.x},${spot.z} failed`);
}

async function setTickRate(page: Page, ms: number): Promise<void> {
    if (!(await cheatQuiet(page, `speed ${ms}`))) {
        throw new Error(`could not send speed ${ms}`);
    }
    const confirmed = await page.evaluate(expected => {
        const lines = (globalThis as never as Abi).__rs2b0t.reader.chat(16);
        return lines.some(l => l.text.includes(`World speed was changed to ${expected}ms`));
    }, ms);
    if (!confirmed) {
        console.warn(`WARN: speed ${ms}ms not confirmed in chat`);
    }
}

async function refillEnergy(page: Page): Promise<void> {
    for (let i = 0; i < 4; i++) {
        await cheatQuiet(page, 'energy');
        await page.waitForTimeout(200);
        const e = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.energy());
        if (e >= 90) {
            return;
        }
    }
}

async function applyNavPaintSettings(page: Page): Promise<void> {
    await setSettings(page, 'Global', {
        showNavPath: PATH_PAINT,
        navTeleports: USE_TELEPORTS
    });
    await page.evaluate(([paint, tele]) => {
        const store = (globalThis as never as Abi).__rs2b0t.SettingsStore;
        store.save('Global', 'showNavPath', paint ? 'true' : 'false');
        store.save('Global', 'navTeleports', tele ? 'true' : 'false');
    }, [PATH_PAINT, USE_TELEPORTS] as const);
}

async function walkLeg(page: Page, dest: Tile, budgetMs: number): Promise<{ walkOk: boolean; tile: Tile | null; logs: string[] }> {
    await page.evaluate(
        ({ destination, budgetMs: budget, teleOn }) => {
            const g = globalThis as never as Abi;
            const logs: string[] = [];
            g.__navTravel = undefined;
            class Probe extends g.__rs2b0t.LoopingBot {
                override async loop(): Promise<void> {
                    try {
                        const walkOk = await g.__rs2b0t.Traversal.walkTo(destination, {
                            radius: 4,
                            timeoutMs: budget,
                            useTeleportCatalog: teleOn,
                            policy: { useTeleports: teleOn, distanceBeforeTeleport: 0 },
                            log: m => {
                                logs.push(m);
                                this.log(m);
                            }
                        });
                        g.__navTravel = { walkOk, tile: g.__rs2b0t.reader.worldTile(), logs };
                    } catch (e) {
                        g.__navTravel = {
                            walkOk: false,
                            tile: g.__rs2b0t.reader.worldTile(),
                            logs: [...logs, String(e)]
                        };
                    } finally {
                        g.rs2b0t.runner.stop();
                    }
                }
            }
            g.rs2b0t.runner.start(
                g.__rs2b0t.registerScript({ name: `NavTravel${Date.now()}`, create: () => new Probe() })
            );
        },
        { destination: dest, budgetMs, teleOn: USE_TELEPORTS }
    );

    for (let i = 0; i < Math.ceil(budgetMs / 1000) + 40; i++) {
        const done = await page.evaluate(() => {
            const g = globalThis as never as Abi;
            return (
                g.__navTravel !== undefined
                && (g.rs2b0t.runner.state === 'stopped' || g.rs2b0t.runner.state === 'idle')
            );
        });
        if (done) {
            break;
        }
        const low = await page
            .evaluate(at => (globalThis as never as Abi).__rs2b0t.reader.energy() <= at, ENERGY_REFILL_AT)
            .catch(() => false);
        if (low) {
            await refillEnergy(page);
        }
        if (i > 0 && i % 20 === 0) {
            const mid = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            console.log(`    …walking ${mid ? `${mid.x},${mid.z}` : '?'}`);
        }
        await page.waitForTimeout(1000);
    }

    const res = await page.evaluate(() => {
        const r = (globalThis as never as Abi).__navTravel;
        delete (globalThis as never as Abi).__navTravel;
        return r;
    });
    if (!res) {
        return { walkOk: false, tile: null, logs: ['no result (timeout)'] };
    }
    return res;
}

function selectRoutes(): TravelRoute[] {
    const all = buildTravelRoutes();
    const filtered = filterTravelRoutes(all, SEGMENT);
    const sliced = OFFSET > 0 ? filtered.slice(OFFSET) : filtered;
    if (LIVE_LIMIT === 0 || !Number.isFinite(LIVE_LIMIT)) {
        return sliced;
    }
    return sliced.slice(0, Math.max(0, LIVE_LIMIT));
}

const routes = selectRoutes();
const stats = travelRouteStats(buildTravelRoutes());

console.log(
    `nav-script-travel-live base=${base} segment=${SEGMENT} offset=${OFFSET} limit=${LIVE_LIMIT === 0 ? 'ALL' : LIVE_LIMIT} `
    + `legs=${routes.length} tele=${USE_TELEPORTS} tick=${TICK_MS}ms energy≤${ENERGY_REFILL_AT}% budget≈${Math.round(BUDGET_MS / 1000)}s`
);
console.log(`  corpus: ${JSON.stringify(stats)}`);

await proof.ensureDirs();
const browser = await launchBrowser({ swiftshader: true });
const t0 = Date.now();
const stamp = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
const results: { id: string; ok: boolean; detail: string; segment: string }[] = [];

try {
    const context = await browser.newContext();
    await context.route('**/*.{js,mjs}', async route => {
        await route.continue({
            headers: {
                ...route.request().headers(),
                'Cache-Control': 'no-cache',
                Pragma: 'no-cache'
            }
        });
    });
    const page = await context.newPage();
    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.log(`[browser:error] ${msg.text()}`);
        }
    });

    const user = process.env.USER_NAME || `nvtr${Date.now().toString(36).slice(-6)}`;
    console.log(`${stamp()} mainlandAccount '${user}' (clean IF_BUTTON logout relog)`);
    await mainlandAccount(page, base, user);
    await applyNavPaintSettings(page);
    await maxmeAndClearDialogs(page);

    if (SEED_QUESTS) {
        const setvars = transportQuestSetvarCommands();
        console.log(`${stamp()} seeding ${setvars.length} transport quest varps…`);
        for (const cmd of setvars) {
            await cheatQuiet(page, cmd);
        }
        await cheatQuiet(page, '~item coins 5000');
        console.log(`${stamp()} relog (quest journal colours)`);
        await relog(page, user);
        await applyNavPaintSettings(page);
        await maxmeAndClearDialogs(page);
        const statuses = await page.evaluate((names: string[]) => {
            const g = globalThis as never as {
                __rs2b0t: { Quests: { status(n: string): string } };
            };
            return names.map(n => ({ name: n, status: g.__rs2b0t.Quests.status(n) }));
        }, transportQuestJournalNames());
        for (const q of statuses.slice(0, 8)) {
            console.log(`  quest ${q.name}: ${q.status}`);
        }
    }

    await setTickRate(page, TICK_MS);
    await refillEnergy(page);

    let pass = 0;
    let fail = 0;
    for (let i = 0; i < routes.length; i++) {
        const r = routes[i]!;
        const id = r.id;
        console.log(`${stamp()} (${i + 1}/${routes.length}) ${id}: ${r.note}`);
        try {
            await teleArrive(page, r.from, 14);
            await refillEnergy(page);
            const res = await walkLeg(page, r.to, BUDGET_MS);
            const dist = res.tile ? cheb(res.tile, r.to) : 9999;
            const ok = res.walkOk && dist <= ARRIVAL;
            const detail = `dist=${dist} walkOk=${res.walkOk} from=${r.from.x},${r.from.z}→${r.to.x},${r.to.z}`;
            console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
            if (!ok) {
                console.log(res.logs.slice(-12).join('\n'));
                fail++;
            } else {
                pass++;
            }
            results.push({ id, ok, detail, segment: r.segment });
        } catch (e) {
            console.error(`FAIL ${id}:`, e);
            results.push({ id, ok: false, detail: String(e), segment: r.segment });
            fail++;
        }
    }

    await setTickRate(page, TICK_RESTORE_MS);

    const outPath = path.join(process.cwd(), 'out', `nav-script-travel-${SEGMENT}-proof.json`);
    fs.writeFileSync(
        outPath,
        JSON.stringify(
            {
                segment: SEGMENT,
                offset: OFFSET,
                limit: LIVE_LIMIT,
                pass,
                fail,
                total: results.length,
                results,
                stats
            },
            null,
            2
        )
    );
    console.log(`${stamp()} proof: ${outPath}`);
    console.log(`${stamp()} ${pass} pass / ${fail} fail / ${results.length} total`);

    if (fail > 0) {
        process.exitCode = 1;
        console.error(`FAIL nav-script-travel-live segment=${SEGMENT}`);
    } else {
        console.log(`PASS nav-script-travel-live segment=${SEGMENT}`);
    }
} finally {
    await browser.close();
}
