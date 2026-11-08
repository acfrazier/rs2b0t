/** S8 377 live qualification: four pure-webwalk routes, three fresh mainland accounts per route.
 *  Run with the canon-1108 ENGINE_DIR/CONTENT_DIR and S8_LIVE_EVIDENCE_DIR set; the isolated client deployment is removed in finally. */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Browser, BrowserContext, Page } from 'playwright-core';

import { deployIsolatedClient, launchBrowser, parseArgs, type IsolatedClient } from './lib/harness.js';
import { cheb, runNavWalk, seedItem, teleArrive, type NavHop, type NavTile } from './lib/navLiveHarness.js';
import { pressCleanLogout } from './lib/cleanLogout.js';
import { cheatQuiet, getServerVarQuiet, mainlandAccount, relog } from './tutorial/harness.js';

const RUNS_PER_ROUTE = Number(process.env.S8_LIVE_RUNS_PER_ROUTE ?? 3);
const ACCOUNT_PREFIX = process.env.S8_LIVE_ACCOUNT_PREFIX ?? 'frs8';
if (!Number.isInteger(RUNS_PER_ROUTE) || RUNS_PER_ROUTE < 1) throw new Error('S8_LIVE_RUNS_PER_ROUTE must be a positive integer');
const ROUTE_FILTER = process.env.S8_LIVE_ROUTE;
const BUDGET_MS = (Number(process.env.BUDGET_S) || 300) * 1000;
const ARRIVAL_READBACK_MS = 20_000;
const EVIDENCE_DIR = process.env.S8_LIVE_EVIDENCE_DIR;
const ENGINE_DIR = process.env.ENGINE_DIR;
if (!EVIDENCE_DIR) throw new Error('set S8_LIVE_EVIDENCE_DIR to the private evidence directory');
if (!ENGINE_DIR) throw new Error('set ENGINE_DIR to the canon-1108 engine');

const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:81'
});

type ExpectedDoor = { id: number; name: string; tile: NavTile };
type DoorReadback = ExpectedDoor & { ops: (string | null)[] };
type RoutePreparation = { seeds: string[]; doorStartReadback?: DoorReadback[] };

type Route = {
    id: string;
    from: NavTile;
    to: NavTile;
    radius: number;
    why: string;
    setup?: (page: Page, user: string) => Promise<string[]>;
    prepareWalk?: (page: Page, from: NavTile) => Promise<RoutePreparation>;
    missingHops: (hops: NavHop[], logs: string[], serverTileTrace: NavTile[]) => string[];
};

const LUMBRIDGE_CLOSED_DOORS: readonly ExpectedDoor[] = [
    { id: 1536, name: 'Door', tile: { x: 3215, z: 3211, level: 0 } },
    { id: 1516, name: 'Large door', tile: { x: 3217, z: 3218, level: 0 } }
];

async function waitForLumbridgeDoorsClosed(page: Page, from: NavTile): Promise<RoutePreparation> {
    await teleArrive(page, { x: 3214, z: 3211, level: 0 }, 12);
    const groundTile = await serverTile(page);
    if (!groundTile || groundTile.level !== 0) throw new Error('pre-walk Lumbridge door check did not land on level 0');

    const handle = await page.waitForFunction(
        expected => {
            const g = globalThis as never as {
                __rs2b0t: {
                    reader: {
                        locs(): { id: number; name: string | null; tile: NavTile; ops: (string | null)[] }[];
                    };
                };
            };
            const locs = g.__rs2b0t.reader.locs();
            const readback = expected.map(wanted => {
                const loc = locs.find(candidate =>
                    candidate.id === wanted.id
                    && candidate.name === wanted.name
                    && candidate.tile.x === wanted.tile.x
                    && candidate.tile.z === wanted.tile.z
                    && candidate.tile.level === wanted.tile.level
                    && candidate.ops.includes('Open')
                );
                return loc ? { id: loc.id, name: loc.name, tile: loc.tile, ops: loc.ops } : null;
            });
            return readback.every(loc => loc !== null) ? readback : false;
        },
        LUMBRIDGE_CLOSED_DOORS,
        { timeout: 360_000, polling: 250 }
    );
    const doorStartReadback = await handle.jsonValue() as DoorReadback[];
    console.log(`WHY pre-walk Lumbridge closed-door loc readback: ${JSON.stringify(doorStartReadback)}`);
    await teleArrive(page, from, 12);
    const startTile = await serverTile(page);
    if (!startTile || startTile.level !== from.level) throw new Error('pre-walk route-start readback mismatch after Lumbridge door check');
    return {
        seeds: [
            'fixture tele-seeded to Lumbridge ground scene for closed-door readback, then back to route start',
            'waited until reader.locs read back Door#1536 at 3215,3211 and Large door#1516 at 3217,3218 with Open available before walk'
        ],
        doorStartReadback
    };
}

const ROUTES: Route[] = [
    {
        id: 'lumb-varrock-bank-doors-stairs',
        from: { x: 3205, z: 3209, level: 2 },
        to: { x: 3253, z: 3420, level: 0 },
        radius: 4,
        why: 'the upper-floor start forces a stair descent; each run waits for and reads back both Lumbridge doors closed before walking; the same run must plan a Lumbridge door hop and log its crossed event; product teleports are disabled',
        prepareWalk: waitForLumbridgeDoorsClosed,
        missingHops: (hops, logs) => {
            const missing: string[] = [];
            const sawDoorHop = hops.some(h => (h.locId === 1536 || h.locId === 1516)
                && (h.kind === 'door' || /door/i.test(h.locName ?? '')));
            const sawDoorLog = logs.some(line => /crossed '(?:Door|Large door)'/i.test(line));
            if (!sawDoorHop) missing.push('no Lumbridge Door#1536 or Large door#1516 hop');
            if (!sawDoorLog) missing.push('Lumbridge door crossing not observed in the walk log');
            if (!hops.some(h => h.kind === 'stair' || /stair|ladder/i.test(h.locName ?? ''))) missing.push('no stair hop');
            if (!logs.some(line => /Climb-down Staircase at .+ ok/i.test(line))) missing.push('stair crossing not observed');
            return missing;
        }
    },
    {
        id: 'gnomeball-gate',
        from: { x: 2382, z: 3488, level: 0 },
        to: { x: 2385, z: 3488, level: 0 },
        radius: 1,
        why: 'no quest or item seed; the path must cross the source-confirmed loc 2394 gate edge; product teleports are disabled',
        missingHops: (hops, logs) => {
            const missing: string[] = [];
            if (!hops.some(h => h.locId === 2394)) missing.push('loc 2394 gate hop absent');
            if (!logs.some(line => /crossed 'Gate'/i.test(line))) missing.push('gate crossing not observed');
            return missing;
        }
    },
    {
        id: 'desert-mining-camp-doors',
        from: { x: 3272, z: 3028, level: 0 },
        to: { x: 3278, z: 9427, level: 0 },
        radius: 1,
        why: 'seed the Metal key required by the outer gate and wear the three Slave disguise items required by the mine entrance; both doors must be traversed; product teleports are disabled',
        setup: async page => {
            await seedItem(page, 'metal_key 1', /metal key/i, 1);
            const disguise = [
                ['slave_shirt', 'Slave shirt'],
                ['slave_robe', 'Slave robe'],
                ['slave_boots', 'Slave boots']
            ] as const;
            for (const [debug, name] of disguise) await seedItem(page, `${debug} 1`, name, 1);
            const notWorn = await page.evaluate(async names => {
                const g = globalThis as never as {
                    __rs2b0t: { Equipment: { equip(name: string): Promise<boolean>; contains(name: string): boolean } };
                };
                const missing: string[] = [];
                for (const name of names) {
                    if (!(await g.__rs2b0t.Equipment.equip(name)) || !g.__rs2b0t.Equipment.contains(name)) {
                        missing.push(name);
                    }
                }
                return missing;
            }, disguise.map(([, name]) => name));
            if (notWorn.length) throw new Error(`could not wear Desert disguise: ${notWorn.join(', ')}`);
            return ['item Metal key x1 (outer-gate prerequisite)', 'worn Slave shirt, Slave robe, and Slave boots (all verified in Equipment)'];
        },
        missingHops: (hops, logs) => {
            const missing: string[] = [];
            if (!hops.some(h => /gate/i.test(h.locName ?? ''))) missing.push('outer gate hop absent');
            if (!hops.some(h => /mine door entrance/i.test(h.locName ?? ''))) missing.push('mine entrance hop absent');
            if (!logs.some(line => /Desert Mining Camp outer gate in .*: crossed at/i.test(line))) {
                missing.push('outer gate crossing not observed');
            }
            if (!logs.some(line => /Desert Mining Camp mine door in: crossed at/i.test(line))) {
                missing.push('mine entrance crossing not observed');
            }
            return missing;
        }
    },
    {
        id: 'west-ardougne-gate',
        from: { x: 2555, z: 3300, level: 0 },
        to: { x: 2560, z: 3300, level: 0 },
        radius: 0,
        why: 'seed only Biohazard completion varp 16 and relog to refresh the quest journal; the path must use its gate edge; product teleports are disabled',
        setup: async (page, user) => {
            if (!(await cheatQuiet(page, 'setvar biohazard 16'))) throw new Error('could not seed Biohazard completion varp');
            await relog(page, user);
            const value = await getServerVarQuiet(page, 'biohazard');
            const status = await page.evaluate(() => {
                const g = globalThis as never as { __rs2b0t: { Quests: { status(name: string): string } } };
                return g.__rs2b0t.Quests.status('Biohazard');
            });
            if (value !== 16 || status !== 'complete') throw new Error(`Biohazard seed readback mismatch: varp=${value} status=${status}`);
            return ['quest varp biohazard=16; clean relog; server varp and journal read back complete'];
        },
        missingHops: (hops, logs) => {
            const missing: string[] = [];
            if (!hops.some(h => h.locId === 8738 || h.locId === 8739)) missing.push('West Ardougne gate transport hop absent');
            if (!logs.some(line => /Open Ardougne Wall Door at \(255[78],(?:3299|3300)\) ok/i.test(line))) {
                missing.push('West Ardougne gate crossing not observed');
            }
            return missing;
        }
    }
];
const ACTIVE_ROUTES = ROUTE_FILTER ? ROUTES.filter(route => route.id === ROUTE_FILTER) : ROUTES;
if (ACTIVE_ROUTES.length === 0) throw new Error(`unknown S8_LIVE_ROUTE '${ROUTE_FILTER}'`);

function hasSavedAccount(engineDir: string, user: string): boolean {
    const profiles = path.join(engineDir, 'data', 'players');
    if (!existsSync(profiles)) return false;
    return readdirSync(profiles).some(profile => existsSync(path.join(profiles, profile, `${user}.sav`)));
}

function freshUser(engineDir: string, used: Set<string>): string {
    for (let attempt = 0; attempt < 512; attempt++) {
        const user = `${ACCOUNT_PREFIX}${randomBytes(2).toString('hex')}`;
        if (!used.has(user) && !hasSavedAccount(engineDir, user)) {
            used.add(user);
            return user;
        }
    }
    throw new Error(`could not allocate a fresh ${ACCOUNT_PREFIX} account name`);
}

async function serverTile(page: Page): Promise<NavTile | null> {
    return page.evaluate(() => {
        const g = globalThis as never as { __rs2b0t: { reader: { serverTile(): NavTile | null } } };
        return g.__rs2b0t.reader.serverTile();
    });
}
type ServerTileTrace = {
    timer: number;
    tiles: NavTile[];
    last: string;
};

async function startServerTileTrace(page: Page): Promise<void> {
    await page.evaluate(() => {
        const g = globalThis as never as Record<string, unknown>;
        const client = globalThis as never as {
            __rs2b0t?: { reader?: { serverTile(): NavTile | null } };
        };
        const trace: ServerTileTrace = { timer: 0, tiles: [], last: '' };
        const sample = (): void => {
            const tile = client.__rs2b0t?.reader?.serverTile();
            if (!tile) return;
            const key = `${tile.x},${tile.z},${tile.level}`;
            if (key === trace.last) return;
            trace.last = key;
            trace.tiles.push(tile);
        };
        sample();
        trace.timer = globalThis.setInterval(sample, 50) as unknown as number;
        g.__navS8ServerTileTrace = trace;
    });
}

async function stopServerTileTrace(page: Page): Promise<NavTile[]> {
    return page.evaluate(() => {
        const g = globalThis as never as Record<string, unknown>;
        const trace = g.__navS8ServerTileTrace as ServerTileTrace | undefined;
        if (!trace) return [];
        globalThis.clearInterval(trace.timer);
        delete g.__navS8ServerTileTrace;
        return trace.tiles;
    });
}
function lumbridgeDoorPassageTiles(tiles: NavTile[]): string[] {
    const seen = new Set<string>();
    for (const tile of tiles) {
        if (tile.level === 0 && ((tile.x === 3215 && tile.z === 3211) || (tile.x === 3217 && tile.z === 3218))) {
            seen.add(`${tile.x},${tile.z},L${tile.level}`);
        }
    }
    return [...seen];
}

async function waitForServerDestination(page: Page, destination: NavTile, radius: number): Promise<NavTile | null> {
    try {
        const handle = await page.waitForFunction(
            ({ destination: target, radius: limit }) => {
                const g = globalThis as never as { __rs2b0t: { reader: { serverTile(): NavTile | null } } };
                const tile = g.__rs2b0t.reader.serverTile();
                return tile && tile.level === target.level
                    && Math.max(Math.abs(tile.x - target.x), Math.abs(tile.z - target.z)) <= limit
                    ? tile
                    : false;
            },
            { destination, radius },
            { timeout: ARRIVAL_READBACK_MS }
        );
        return await handle.jsonValue() as unknown as NavTile;
    } catch {
        return serverTile(page);
    }
}

function hopText(hops: NavHop[]): string[] {
    return hops.map(h => `${h.kind ?? '?'}:${h.locName ?? '?'}#${h.locId ?? '?'} ${h.action ?? '?'} @${h.x},${h.z},${h.level}`);
}

const evidence: {
    base: string;
    engineDirConfigured: boolean;
    deployPage: string | null;
    routes: {
        route: string;
        run: number;
        user: string;
        freshSaveBeforeLogin: boolean;
        seeds: string[];
        step: string;
        why: string;
        walkOk: boolean;
        clientTile: NavTile | null;
        serverTile: NavTile | null;
        serverDistance: number;
        hops: string[];
        serverTileTrace: NavTile[];
        doorPassageTiles: string[];
        doorStartReadback: DoorReadback[] | null;
        pass: boolean;
        failures: string[];
    }[];
} = { base, engineDirConfigured: true, deployPage: null, routes: [] };
const used = new Set<string>();
let deployment: IsolatedClient | undefined;
let browser: Browser | undefined;
let context: BrowserContext | undefined;
let fatal: string | null = null;

try {
    const tag = `s8-live-${process.pid}-${Date.now().toString(36)}`;
    deployment = deployIsolatedClient(tag, ENGINE_DIR, 'out', { seedHtml: true });
    evidence.deployPage = deployment.page;
    browser = await launchBrowser({ swiftshader: true });
    context = await browser.newContext();

    for (const route of ACTIVE_ROUTES) {
        for (let run = 1; run <= RUNS_PER_ROUTE; run++) {
            const user = freshUser(ENGINE_DIR, used);
            const page = await context.newPage();
            const seeds = [
                'new account; mainlandAccount tele-seeds off Tutorial Island, sets tutorial=1000, and clean-relogs to unlock the main world',
                `test fixture position tele-seeded to ${route.from.x},${route.from.z},L${route.from.level}; walker teleports disabled`
            ];
            const step = `STEP route=${route.id} run=${run}/${RUNS_PER_ROUTE} account=${user} start=${route.from.x},${route.from.z},L${route.from.level} destination=${route.to.x},${route.to.z},L${route.to.level}`;
            const why = `WHY ${route.id}: ${route.why}; final receipt uses serverTile from the server-authoritative update`;
            console.log(step);
            console.log(why);
            let walkOk = false;
            let clientTile: NavTile | null = null;
            let observedServerTile: NavTile | null = null;
            let hops: NavHop[] = [];
            let walkLogs: string[] = [];
            let serverTileTrace: NavTile[] = [];
            let doorStartReadback: DoorReadback[] | null = null;
            let failures: string[] = [];
            let walked = false;
            try {
                await mainlandAccount(page, base, user, deployment.page);
                if (route.setup) seeds.push(...await route.setup(page, user));
                await teleArrive(page, route.from, 12);
                const preparation = await route.prepareWalk?.(page, route.from);
                if (preparation) {
                    seeds.push(...preparation.seeds);
                    doorStartReadback = preparation.doorStartReadback ?? null;
                }
                const startTile = await serverTile(page);
                console.log(`WHY fixture position ${startTile ? `${startTile.x},${startTile.z},L${startTile.level}` : 'unreadable'} was tele-seeded on this fresh account; walker teleports remain off`);
                if (!startTile) throw new Error('serverTile unavailable at the seeded route start');

                await startServerTileTrace(page);
                const result = await runNavWalk(page, {
                    dest: route.to,
                    budgetMs: BUDGET_MS,
                    radius: route.radius,
                    useTeleports: false,
                    distanceBeforeTeleport: 0,
                    pollMs: 1000,
                    progressEverySec: 30,
                    resultKey: '__navS8Live',
                    scriptNamePrefix: 'NavS8Live'
                });
                walked = true;
                walkOk = result.walkOk;
                clientTile = result.tile;
                hops = result.hops;
                walkLogs = result.logs;
                serverTileTrace = await stopServerTileTrace(page);
                observedServerTile = await waitForServerDestination(page, route.to, route.radius);
                const clientDistance = clientTile ? cheb(clientTile, route.to) : 9999;
                const serverDistance = observedServerTile ? cheb(observedServerTile, route.to) : 9999;
                failures = [
                    ...(!walkOk ? ['walkTo returned false'] : []),
                    ...(clientDistance > route.radius ? [`client tile distance ${clientDistance} exceeds ${route.radius}`] : []),
                    ...(serverDistance > route.radius ? [`serverTile distance ${serverDistance} exceeds ${route.radius}`] : []),
                    ...route.missingHops(hops, walkLogs, serverTileTrace)
                ];
                const pass = failures.length === 0;
                const hopsSeen = hopText(hops);
                const doorPassageTiles = lumbridgeDoorPassageTiles(serverTileTrace);
                const receipt = {
                    route: route.id,
                    run,
                    user,
                    freshSaveBeforeLogin: true,
                    seeds,
                    step,
                    why,
                    walkOk,
                    clientTile,
                    serverTile: observedServerTile,
                    serverDistance,
                    hops: hopsSeen,
                    walkLogs,
                    serverTileTrace,
                    doorPassageTiles,
                    doorStartReadback,
                    pass,
                    failures
                };
                evidence.routes.push(receipt);
                console.log(`${pass ? 'PASS' : 'FAIL'} route=${route.id} run=${run}/${RUNS_PER_ROUTE} account=${user} walkOk=${walkOk} clientTile=${clientTile ? `${clientTile.x},${clientTile.z},L${clientTile.level}` : 'null'} serverTile=${observedServerTile ? `${observedServerTile.x},${observedServerTile.z},L${observedServerTile.level}` : 'null'} serverDistance=${serverDistance} hops=${JSON.stringify(hopsSeen)}${failures.length ? ` failures=${failures.join('; ')}` : ''}`);
                for (const line of walkLogs) console.log(`  ${line}`);
                if (doorPassageTiles.length) console.log(`  serverTile door passage: ${doorPassageTiles.join(', ')}`);
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                if (!walked) failures.push(detail);
                const doorPassageTiles = lumbridgeDoorPassageTiles(serverTileTrace);
                const receipt = {
                    route: route.id,
                    run,
                    user,
                    freshSaveBeforeLogin: true,
                    seeds,
                    step,
                    why,
                    walkOk,
                    clientTile,
                    serverTile: observedServerTile,
                    serverDistance: observedServerTile ? cheb(observedServerTile, route.to) : 9999,
                    hops: hopText(hops),
                    walkLogs,
                    serverTileTrace,
                    doorPassageTiles,
                    doorStartReadback,
                    pass: false,
                    failures: failures.length ? failures : [detail]
                };
                evidence.routes.push(receipt);
                console.error(`FAIL route=${route.id} run=${run}/${RUNS_PER_ROUTE} account=${user}: ${detail}`);
            } finally {
                await pressCleanLogout(page).catch(error => {
                    console.error(`logout ${user}: ${error instanceof Error ? error.message : String(error)}`);
                });
                await page.close().catch(() => undefined);
            }
        }
    }
} catch (error) {
    fatal = error instanceof Error ? error.message : String(error);
    console.error(`FATAL S8 live harness: ${fatal}`);
    process.exitCode = 1;
} finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    deployment?.cleanup();
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    const receiptPath = path.join(EVIDENCE_DIR, 'nav-s8-live-receipts.json');
    writeFileSync(receiptPath, `${JSON.stringify({ ...evidence, fatal, createdAt: new Date().toISOString() }, null, 2)}\n`);
    console.log(`route-receipt=${receiptPath}`);
}

const passes = evidence.routes.filter(row => row.pass).length;
if (fatal || evidence.routes.length !== ACTIVE_ROUTES.length * RUNS_PER_ROUTE || passes !== ACTIVE_ROUTES.length * RUNS_PER_ROUTE) {
    process.exitCode = 1;
}
console.log(`S8 live summary ${passes}/${ACTIVE_ROUTES.length * RUNS_PER_ROUTE} pass`);
