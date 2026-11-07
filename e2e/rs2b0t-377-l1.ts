import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Browser, Page } from 'playwright-core';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { cheatQuiet, deployIsolatedClient, launchBrowser, pageTemplatePath, type IsolatedClient } from './lib/harness.js';
import { action, cleanLogout, cycles, installObserver, login, observe, quiescent, readValue, walk, type Npc } from './tap-377/capture-page.js';
import { startTap, type TapSession } from '../tools/tap-377/tap.js';
import { loadEngineProtocol } from '../tools/tap-377/protocol.js';
import { parseCacheBundle, parseRecording } from '../tools/tap-377/check-recording.js';
import { MiniMenuAction } from '../src/client/shell/MiniMenuAction.js';

// The isolated browser bundle owns these in-process objects; Playwright cannot retain their TypeScript types.
interface L1Window {
    rs2b0t: {
        client: {
            out: { rsaenc(mod: bigint, exp: bigint): void };
            openLoginStream(): Promise<{ read(): Promise<number> }>;
            login(u: string, p: string, reconnect: boolean): Promise<void>;
            stream: unknown;
            ingame: boolean;
            loginUser: string;
            loginPass: string;
            loginMes1: string;
            loginMes2: string;
            localPlayer: unknown;
            useMode: number;
            targetMode: number;
            isMenuOpen: boolean;
            dialogInputOpen: boolean;
        };
    };
    __l1Player?: unknown;
    __rs2b0t: {
        Game: { sceneReady(): boolean };
        Execution: { delayUntil(condition: () => boolean, timeout: number): Promise<boolean> };
    };
}

async function sceneReady(page: Page): Promise<void> {
    assert(
        await page.evaluate(async () => {
            const g = globalThis as unknown as L1Window;
            return g.__rs2b0t.Execution.delayUntil(() => g.__rs2b0t.Game.sceneReady(), 60_000);
        }),
        'L1 scene readiness deadline'
    );
}

// Content a15d0faa8: tutorial.rs2:301-312 and pack/varp.pack:407. Private tutorial 281 is server-only.
const TUTORIAL_OVERLAY = 406;
const { values } = parseArgs({
    options: {
        engine: { type: 'string' },
        content: { type: 'string' },
        out: { type: 'string' },
        origin: { type: 'string', default: 'http://127.0.0.1:81' },
        'seed-html': { type: 'boolean' },
        'account-prefix': { type: 'string', default: 'l1x' },
        replay: { type: 'boolean' }
    },
    strict: true
});
const required = (name: 'engine' | 'content' | 'out'): string => {
    const value = values[name];
    assert(value, `L1 requires --${name}`);
    return resolve(value);
};
const output = required('out');
const accountPrefix = values['account-prefix']!;
assert.match(accountPrefix, /^[a-z0-9]{1,4}$/, 'L1 account prefix must contain one to four lowercase letters or digits');

function revision(directory: string): string {
    const result = Bun.spawnSync(['git', '-C', directory, 'rev-parse', 'HEAD']);
    assert.equal(result.exitCode, 0, 'L1 commit lookup failed');
    const commit = result.stdout.toString().trim();
    assert.match(commit, /^[a-f0-9]{40}$/);
    return commit;
}

async function until(page: Page, predicate: () => Promise<boolean>, label: string): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        const snapshot = await observe(page);
        assert(!snapshot.foreignPlayer, 'L1 interference: foreign player');
        assert(!snapshot.packetFailure, 'L1 product: packet handler failure');
        if (await predicate()) return;
        await cycles(page, 1);
    }
    throw new Error(`L1 assertion timed out: ${label}`);
}

async function dialogueText(page: Page): Promise<string> {
    return (await readValue<string[]>(page, 'chatModalTexts')).join(' ');
}

async function serverVar(page: Page, name: string): Promise<number> {
    const before = await readValue<{ text: string }[]>(page, 'chat', 100);
    assert(await cheatQuiet(page, `getvar ${name}`, 0), 'L1 getvar command refused');
    let value: number | undefined;
    await until(
        page,
        async () => {
            const lines = await readValue<{ text: string }[]>(page, 'chat', 100);
            // A new reply is required, not an old matching readback left in the chat buffer.
            if (JSON.stringify(lines) === JSON.stringify(before)) return false;
            const match = lines.find(line => line.text.toLowerCase().startsWith(`get ${name}:`))?.text.match(/:\s*(-?\d+)/);
            if (match) value = Number(match[1]);
            return value !== undefined;
        },
        `fresh getvar ${name} reply`
    );
    return value!;
}

async function wrongKey(page: Page, username: string, secret: string): Promise<number[]> {
    return page.evaluate(
        async ({ username, secret }) => {
            const g = globalThis as unknown as L1Window;
            const c = g.rs2b0t.client;
            const rsa = c.out.rsaenc,
                open = c.openLoginStream;
            const replies: number[] = [];
            // Negative fixture only: change the public modulus, never the engine key or server state.
            c.out.rsaenc = function (mod, exp) {
                rsa.call(this, mod + 2n, exp);
            };
            c.openLoginStream = async function () {
                const stream = await open.call(c),
                    read = stream.read;
                stream.read = async function () {
                    const byte = await read.call(this);
                    replies.push(byte);
                    return byte;
                };
                return stream;
            };
            try {
                await c.login(username, secret, false);
                if (c.ingame) throw new Error('L1 wrong key unexpectedly logged in');
                // The first eight single-byte reads are the server's discarded handshake preamble.
                return replies.slice(8);
            } finally {
                c.out.rsaenc = rsa;
                c.openLoginStream = open;
            }
        },
        { username, secret }
    );
}

interface RelogAttempt {
    timestamp: string;
    replies: number[];
    ingame: boolean;
    banner: string[];
    delayMs: number;
    elapsedDelayMs?: number;
}

async function relogAfterRelease(page: Page, username: string, secret: string, attempts: RelogAttempt[]): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const result = await page.evaluate(async ({ username, secret }) => {
            const c = (globalThis as unknown as L1Window).rs2b0t.client;
            const open = c.openLoginStream;
            const replies: number[] = [];
            c.openLoginStream = async function () {
                const stream = await open.call(c);
                const read = stream.read;
                stream.read = async function () {
                    const byte = await read.call(this);
                    replies.push(byte);
                    return byte;
                };
                return stream;
            };
            try {
                await c.login(username, secret, false);
                return { timestamp: new Date().toISOString(), replies: replies.slice(8), ingame: c.ingame, banner: [c.loginMes1, c.loginMes2] };
            } finally {
                c.openLoginStream = open;
            }
        }, { username, secret });
        const row: RelogAttempt = { ...result, delayMs: 0 };
        attempts.push(row);
        if (result.ingame) {
            assert.equal(result.replies[1], 2, 'L1 server release must produce login reply 2');
            await quiescent(page);
            return;
        }
        assert.deepEqual(result.replies, [0, 5], 'L1 relog rejected for a reason other than pending session release');
        assert.deepEqual(result.banner, ['Your account is already logged in.', 'Try again in 60 secs...']);
        assert.equal(attempt, 0, 'L1 server session remained occupied after two reply-5 attempts');
        row.delayMs = 60_000;
        const started = Date.now();
        // This is the observed reply-5 backoff, not an unconditional delay after logout.
        await page.waitForFunction(deadline => Date.now() >= deadline, started + row.delayMs, { timeout: row.delayMs + 5000 });
        row.elapsedDelayMs = Date.now() - started;
        assert(row.elapsedDelayMs >= row.delayMs, 'L1 reply-5 backoff ended early');
    }
}

async function replay(): Promise<void> {
    const protocol = await loadEngineProtocol(required('engine'));
    // The runtime imports bun:test and DOM-dependent client modules. Only the preloaded replay subprocess may load it.
    const { replayRecording } = await import('../test/io/replay/runtime.js');
    try {
        const report = await replayRecording(parseRecording(readFileSync(join(output, 'session.jsonl'), 'utf8')), parseCacheBundle(readFileSync(join(output, 'cache.json'), 'utf8')), protocol);
        writeFileSync(join(output, 'replay.json'), JSON.stringify(report, null, 2) + '\n');
    } finally {
        // The standalone runner owns the preloaded DOM, unlike a bun:test suite.
        await GlobalRegistrator.unregister();
    }
}

async function live(): Promise<void> {
    assert(!existsSync(output), 'L1 output directory must be absent');
    mkdirSync(output, { recursive: true });
    const engine = required('engine'),
        content = required('content');
    const designAccept = readFileSync(join(content, 'pack/interface.pack'), 'utf8').match(/^(\d+)=player_kit:accept$/m);
    assert(designAccept, 'L1 fixture: missing player_kit:accept component');
    const account = `${accountPrefix}${randomBytes(4).toString('hex')}`,
        secret = randomBytes(8).toString('hex');
    const tag = account;
    const receipt: Record<string, unknown> = { status: 'FAIL', account, tag, clientCommit: revision(process.cwd()), contentCommit: revision(content), steps: [] };
    receipt.cellSha256 = createHash('sha256')
        .update(readFileSync(import.meta.path))
        .digest('hex');
    const steps = receipt.steps as { label: string; state: unknown }[];
    let deployment: IsolatedClient | undefined, tap: TapSession | undefined;
    let browser: Browser | undefined;
    let stage = 'deploy';
    try {
        const sharedHtml = join(engine, 'public/bot.html');
        const sharedState = () =>
            existsSync(sharedHtml)
                ? { sha256: createHash('sha256').update(readFileSync(sharedHtml)).digest('hex'), mtimeMs: statSync(sharedHtml).mtimeMs }
                : null;
        const sharedBefore = sharedState();
        const templatePath = pageTemplatePath(join(engine, 'public'), values['seed-html'] ?? false);
        const template = readFileSync(templatePath, 'utf8');
        deployment = deployIsolatedClient(tag, engine, join(output, 'build'), { seedHtml: values['seed-html'] ?? false });
        const deployedHtml = readFileSync(join(engine, 'public', deployment.page), 'utf8');
        assert.equal(deployedHtml, template.replaceAll('./bot/botclient.js', `./bot/${tag}/botclient.js`), 'L1 deployed template readback');
        const sharedAfter = sharedState();
        receipt.deployment = {
            page: deployment.page,
            seedHtml: templatePath === 'public-bot/bot.html',
            template: templatePath === sharedHtml ? 'engine/public/bot.html' : 'public-bot/bot.html',
            templateReadbackMatches: deployedHtml === template.replaceAll('./bot/botclient.js', `./bot/${tag}/botclient.js`),
            writes: [`public/bot-${tag}.html`, `public/bot/${tag}/`],
            sharedBotHtmlWritten: JSON.stringify(sharedBefore) !== JSON.stringify(sharedAfter),
            sharedBotHtmlBefore: sharedBefore,
            sharedBotHtmlAfter: sharedAfter
        };
        assert.deepEqual(sharedAfter, sharedBefore, 'L1 shared HTML changed during deploy');
        const protocol = await loadEngineProtocol(engine);
        assert.equal(protocol.revision, 377);
        const playerInfo = protocol.server.find(packet => packet.name === 'PLAYER_INFO');
        assert(playerInfo);
        tap = await startTap({
            engineDir: engine,
            origin: values.origin!,
            recordingPath: join(output, 'session.jsonl'),
            cachePath: join(output, 'cache.json'),
            accountPrefix,
            clientCommit: String(receipt.clientCommit),
            contentCommit: String(receipt.contentCommit)
        });
        browser = await launchBrowser({ swiftshader: true });
        const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
        let pageErrors = 0;
        page.on('pageerror', () => {
            pageErrors++;
        });
        await page.goto(new URL(`${deployment.page}?lowmem=1&autorelogin=0&randomevents=0&run=0`, tap.url).href);
        await installObserver(page, accountPrefix, playerInfo.id);
        const checkpoint = async (label: string) => {
            const snapshot = await quiescent(page);
            tap!.checkpoint(label, snapshot.state, snapshot.inboundCount);
            steps.push({ label, state: snapshot });
            return snapshot;
        };
        stage = 'login';
        await login(page, account, secret);
        await sceneReady(page);
        if ((await observe(page)).main !== -1) {
            await action(page, 'ifButton', Number(designAccept[1]));
            await until(page, async () => (await observe(page)).main === -1, 'appearance accepted');
        }
        const first = await checkpoint('login-scene');
        assert.equal(first.state.sceneState, 2);
        stage = 'walk';
        await walk(page, 1, 0);
        const walked = await checkpoint('walk-one-tile');
        assert.deepEqual(walked.state.serverTile, { ...first.state.serverTile, x: first.state.serverTile.x + 1 });
        stage = 'guide';
        assert.equal(await serverVar(page, 'tutorial'), 1);
        type GuideSnapshot = Npc & {
            tile: { x: number; z: number; level: number };
            networkTile: { x: number; z: number; level: number };
        };
        let guide: GuideSnapshot | undefined;
        let stableTile = '';
        let stableTick = -1;
        // A moving adjacent NPC can leave a zero-distance approach before the server processes the talk action.
        await until(page, async () => {
            const snapshot = await observe(page);
            guide = (await readValue<GuideSnapshot[]>(page, 'npcs')).find(npc => npc.name === 'RuneScape Guide');
            assert(guide, 'L1 fixture: Guide absent');
            const { tile, networkTile } = guide;
            const player = snapshot.state.serverTile;
            const stationary = tile.x === networkTile.x && tile.z === networkTile.z;
            const distance = Math.max(Math.abs(player.x - networkTile.x), Math.abs(player.z - networkTile.z));
            const key = stationary && distance >= 2 ? `${networkTile.x},${networkTile.z}` : '';
            if (!key || key !== stableTile) {
                stableTile = key;
                stableTick = snapshot.tick;
                return false;
            }
            return snapshot.tick > stableTick;
        }, 'stationary Guide with a nonzero approach');
        assert(guide, 'L1 fixture: Guide absent');
        steps.push({ label: 'guide-target', state: guide });
        await action(page, 'menuAction', MiniMenuAction.OP_NPC1, guide.index, 0, 0);
        await until(page, async () => (await observe(page)).chat !== -1, 'Guide dialogue');
        steps.push({ label: 'guide-talk', state: await dialogueText(page) });
        let finishedGuide = false;
        for (let n = 0; n < 16; n++) {
            await until(page, async () => (await readValue<number>(page, 'chatContinueComId')) >= 0 || (await readValue<unknown[]>(page, 'chatOptions')).length > 0, 'Guide controls ready');
            const before = await dialogueText(page);
            const choices = await readValue<{ text: string; comId: number }[]>(page, 'chatOptions');
            steps.push({ label: 'guide-dialogue', state: { text: before, choices } });
            if (choices.length) {
                const decline = choices.find(choice => choice.text === 'No, thank you.');
                assert(decline, 'L1 oracle: unexpected Guide options');
                await action(page, 'ifButton', decline.comId);
            } else await action(page, 'continueDialog');
            if (before.includes('To continue the tutorial go through that door')) {
                finishedGuide = true;
                break;
            }
            await until(page, async () => (await dialogueText(page)) !== before, 'Guide transition');
        }
        assert(finishedGuide, 'L1 Guide dialogue exceeded its transition bound');
        const tutorial = await serverVar(page, 'tutorial');
        const clientOverlay = await readValue<number>(page, 'varp', TUTORIAL_OVERLAY);
        const serverOverlay = await serverVar(page, 'tutorial_progress_overlay');
        assert.equal(tutorial, 4);
        assert.equal(clientOverlay, 1);
        assert.equal(serverOverlay, 1);
        steps.push({ label: 'server-and-client-varp', state: { tutorial, overlayId: TUTORIAL_OVERLAY, clientOverlay, serverOverlay } });
        await checkpoint('tutorial-varp-applied');
        await page.screenshot({ path: join(output, 'scene.png') });
        await page.evaluate(() => {
            const g = globalThis as unknown as L1Window;
            g.__l1Player = g.rs2b0t.client.localPlayer;
        });
        stage = 'logout';
        await cleanLogout(page);
        const reset = await page.evaluate(() => {
            const g = globalThis as unknown as L1Window;
            const c = g.rs2b0t.client;
            return { streamClosed: c.stream === null, ingame: c.ingame, credentialsCleared: c.loginUser === '' && c.loginPass === '' };
        });
        assert.deepEqual(reset, { streamClosed: true, ingame: false, credentialsCleared: true });
        steps.push({ label: 'logout-reset', state: reset });
        stage = 'relogin';
        const relogAttempts: RelogAttempt[] = [];
        receipt.relogAttempts = relogAttempts;
        await relogAfterRelease(page, account, secret, relogAttempts);
        assert.deepEqual(tap.diagnostics.rejectedLoginReplies, relogAttempts.filter(attempt => !attempt.ingame).map(attempt => attempt.replies[1]));
        await sceneReady(page);
        const relog = await checkpoint('relogin-scene');
        assert.equal(relog.segment, first.segment + relogAttempts.length);
        assert.equal(tap.diagnostics.activeSegment, 2, 'L1 relog must start the second successful recording segment');
        const relogReset = await page.evaluate(() => {
            const g = globalThis as unknown as L1Window;
            const c = g.rs2b0t.client;
            return { newPlayer: c.localPlayer !== g.__l1Player, useMode: c.useMode, targetMode: c.targetMode, menuOpen: c.isMenuOpen, inputOpen: c.dialogInputOpen };
        });
        assert.deepEqual(relogReset, { newPlayer: true, useMode: 0, targetMode: 0, menuOpen: false, inputOpen: false });
        assert.equal(await readValue<number>(page, 'varp', TUTORIAL_OVERLAY), 1);
        assert.equal(await serverVar(page, 'tutorial'), 4);
        assert.equal(await serverVar(page, 'tutorial_progress_overlay'), 1);
        steps.push({ label: 'relogin-reset', state: relogReset });
        await checkpoint('relogin-persisted-varp');
        await cleanLogout(page);
        assert.equal(pageErrors, 0, 'L1 product: uncaught browser error');
        stage = 'recording';
        await tap.finalize();
        receipt.diagnostics = tap.diagnostics;
        await tap.close();
        tap = undefined;
        stage = 'wrong-key';
        // The tap intentionally rejects undecryptable login requests. Test reply 6 directly against the engine.
        const wrongPage = await browser.newPage();
        await wrongPage.goto(new URL(deployment.page, values.origin).href);
        await installObserver(wrongPage, accountPrefix, playerInfo.id);
        const replies = await wrongKey(wrongPage, account, secret);
        assert.deepEqual(replies, [0, 6], 'L1 wrong-key login reply');
        receipt.wrongKeyReplies = replies;
        stage = 'replay';
        const child = Bun.spawn([process.execPath, '--preload', './test/setup-dom.ts', import.meta.path, '--replay', '--engine', engine, '--out', output], {
            stdout: Bun.file(join(output, 'replay.log')),
            stderr: Bun.file(join(output, 'replay-errors.log'))
        });
        assert.equal(await child.exited, 0, 'L1 runtime replay failed');
        receipt.replay = JSON.parse(readFileSync(join(output, 'replay.json'), 'utf8'));
        receipt.artifacts = Object.fromEntries(
            ['scene.png', 'session.jsonl', 'cache.json', 'replay.json'].map(file => [
                file,
                createHash('sha256')
                    .update(readFileSync(join(output, file)))
                    .digest('hex')
            ])
        );
        receipt.status = 'PASS';
    } catch (error) {
        receipt.stage = stage;
        receipt.diagnostics = tap?.diagnostics;
        const failedPage = browser?.contexts()[0]?.pages()[0];
        if (failedPage) {
            receipt.failureState = await observe(failedPage).catch(() => null);
            receipt.failureChat = await readValue(failedPage, 'chat', 100).catch(() => null);
            receipt.failureNpcs = await readValue<Npc[]>(failedPage, 'npcs').catch(() => null);
            receipt.loginBanner = await failedPage
                .evaluate(() => {
                    const g = globalThis as unknown as L1Window;
                    const c = g.rs2b0t.client;
                    return [c.loginMes1, c.loginMes2];
                })
                .catch(() => null);
        }
        receipt.failure = error instanceof Error ? error.message.replaceAll(output, '<evidence>').replaceAll(engine, '<engine>').replaceAll(content, '<content>') : 'unknown failure';
        throw error;
    } finally {
        await browser?.close();
        await tap?.close();
        deployment?.cleanup();
        receipt.cleanup = { isolatedDeploymentRemoved: deployment !== undefined, browserClosed: true, tapClosed: true };
        writeFileSync(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    }
    console.log('L1 PASS');
}

if (values.replay) {
    await replay();
    // Standalone Bun replay retains this VM after runtime and DOM cleanup, even with no reported active resources.
    // Exit only after the runtime assertions, report write, and teardown all succeeded.
    process.exit(0);
} else await live();
