import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, type Browser, type Page } from 'playwright-core';
import { engineLoginKey } from '../lib/engineLoginKey.js';
import { assertNoForeignPlayer, cycles, installObserver, observe, quiescent, type CaptureSnapshot } from './capture-page.js';
import { assertCaptureFrames, captureScenario, type Scenario, type ScenarioContext } from './capture-scenarios.js';
import { startTap, type TapSession } from '../../tools/tap-377/tap.js';
import { loadEngineProtocol } from '../../tools/tap-377/protocol.js';

const ROOT = resolve(import.meta.dir, '../..');
const scenarios = new Set<Scenario>(['reference', 'tutorial', 'mainland', 'instance']);
interface Options {
    engineDir: string;
    origin: string;
    scenario: Scenario;
    output: string;
    accountPrefix: string;
    clientCommit: string;
    contentCommit: string;
    harnessLib?: string;
    quietLock?: string;
    headless: boolean;
}

function options(): Options {
    const { values } = parseArgs({ options: {
        'engine-dir': { type: 'string' }, origin: { type: 'string' }, scenario: { type: 'string' }, out: { type: 'string' },
        'account-prefix': { type: 'string' }, 'client-commit': { type: 'string' }, 'content-commit': { type: 'string' },
        'harness-lib': { type: 'string' }, 'quiet-lock': { type: 'string' }, headless: { type: 'boolean', default: false }
    }, strict: true });
    const required = (name: keyof typeof values): string => {
        const value = values[name];
        if (typeof value !== 'string' || !value) throw new Error(`capture requires --${name}`);
        return value;
    };
    const scenario = required('scenario');
    if (!scenarios.has(scenario as Scenario)) throw new Error('capture scenario must be reference, tutorial, mainland, or instance');
    const accountPrefix = required('account-prefix');
    if (!/^[a-z][a-z0-9]{1,4}$/.test(accountPrefix)) throw new Error('capture account prefix must be 2-5 lowercase letters or digits');
    const clientCommit = required('client-commit'), contentCommit = required('content-commit');
    if (![clientCommit, contentCommit].every(value => /^[a-f0-9]{40}$/.test(value))) throw new Error('capture commits must be full 40-character hexadecimal identifiers');
    return {
        engineDir: resolve(required('engine-dir')), origin: required('origin'), scenario: scenario as Scenario,
        output: resolve(required('out')), accountPrefix, clientCommit, contentCommit,
        harnessLib: values['harness-lib'], quietLock: values['quiet-lock'], headless: values.headless ?? false
    };
}

async function referenceAssets(engineDir: string, build: string): Promise<(request: Request) => Promise<Response | undefined>> {
    const key = engineLoginKey(engineDir); // Read in place; only the public half enters the temporary browser build.
    const child = Bun.spawn([process.execPath, 'bot.bundle.ts', 'dev'], {
        cwd: ROOT, env: { ...process.env, TARGET: 'local', STRICT_PACKETS: '1', STRICT_CONFIG: '1', B0T_OUT_DIR: build, LOCAL_RSAE: key.rsae, LOCAL_RSAN: key.rsan },
        stdout: 'ignore', stderr: 'ignore'
    });
    if (await child.exited !== 0) throw new Error('capture reference browser build failed');
    const assets = new Set(['botclient.js', 'botclient.js.map', 'multibox.js', 'multibox.js.map', 'ondemandworker.js', 'ondemandworker.js.map', 'navworker.js', 'navworker.js.map', 'spessasynth_processor.min.js', 'version.json', 'target.json']);
    return async request => {
        const path = new URL(request.url).pathname;
        if (path === '/bot.html') return new Response(Bun.file(join(ROOT, 'public-bot/bot.html')), { headers: { 'content-type': 'text/html' } });
        if (path.startsWith('/bot/') && assets.has(path.slice(5))) return new Response(Bun.file(join(build, path.slice(5))));
        return undefined;
    };
}

async function approvedAccountHelper(path: string | undefined): Promise<ScenarioContext['mainlandAccount']> {
    if (!path) return undefined;
    // The operator selects an installed private helper at runtime; it is not a public-repo dependency.
    const imported: unknown = await import(pathToFileURL(resolve(path)).href);
    if (!imported || typeof imported !== 'object' || !('mainlandAccount' in imported) || typeof imported.mainlandAccount !== 'function') throw new Error('capture account helper has no mainlandAccount function');
    const helper = imported.mainlandAccount;
    return async (page: Page, username: string, secret: string) => {
        // Third-party diagnostics may contain credentials. The capture receipt records only labelled fixture operations.
        const log = console.log, warn = console.warn, error = console.error;
        console.log = console.warn = console.error = () => undefined;
        try { return await helper(page, username, secret); }
        finally { console.log = log; console.warn = warn; console.error = error; }
    };
}

function digest(path: string): Promise<string> {
    return Bun.file(path).arrayBuffer().then(bytes => createHash('sha256').update(new Uint8Array(bytes)).digest('hex'));
}

export async function capture(options: Options): Promise<void> {
    if (options.quietLock && existsSync(options.quietLock)) throw new Error('capture refused: the engine quiet lock is present');
    if (existsSync(options.output)) throw new Error('capture output must be an absent directory');
    mkdirSync(options.output, { recursive: true });
    const recordingPath = join(options.output, `${options.scenario}.jsonl`), cachePath = join(options.output, 'cache.json');
    const username = options.accountPrefix + randomBytes(4).toString('hex').slice(0, 7);
    const secret = randomBytes(8).toString('hex');
    const steps: { label: string; details?: Record<string, unknown> }[] = [];
    let browser: Browser | undefined, page: Page | undefined, tap: TapSession | undefined;
    let browserBuild: string | undefined;
    let stage = 'initialization', succeeded = false;
    let failure: { name: string; message?: string } | undefined;
    let failureState: CaptureSnapshot | undefined;
    let pageErrors = 0;
    try {
        const protocol = await loadEngineProtocol(options.engineDir);
        if (protocol.revision !== (options.scenario === 'reference' ? 289 : 377)) throw new Error('capture scenario and engine revisions differ');
        const playerInfo = protocol.server.find(packet => packet.name === 'PLAYER_INFO');
        if (!playerInfo) throw new Error('capture protocol has no PLAYER_INFO descriptor');
        let requestHandler: ((request: Request) => Promise<Response | undefined>) | undefined;
        if (options.scenario === 'reference') {
            browserBuild = mkdtempSync(join(tmpdir(), 'frtap-capture-browser-'));
            requestHandler = await referenceAssets(options.engineDir, browserBuild);
        }
        const mainlandAccount = await approvedAccountHelper(options.harnessLib);
        stage = 'tap-start';
        tap = await startTap({
            engineDir: options.engineDir, origin: options.origin, recordingPath, cachePath, accountPrefix: options.accountPrefix,
            clientCommit: options.clientCommit, contentCommit: options.contentCommit, requestHandler
        });
        stage = 'browser-boot';
        browser = await chromium.launch({ channel: 'chrome', headless: options.headless });
        page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
        page.on('pageerror', () => { pageErrors++; });
        const path = options.scenario === 'reference' ? '/bot.html?lowmem=1&autorelogin=0&randomevents=0&run=0' : '/harness.html?lowmem=1';
        await page.goto(new URL(path, tap.url).href, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await installObserver(page, options.accountPrefix, playerInfo.id);
        stage = options.scenario;
        const activeTap = tap, activePage = page;
        await captureScenario(options.scenario, {
            page, username, secret, mainlandAccount,
            note: (label, details) => { stage = label; steps.push({ label, details }); },
            checkpoint: async label => {
                stage = label;
                const snapshot = await quiescent(activePage);
                await activeTap.checkpoint(label, snapshot.state, snapshot.inboundCount);
                steps.push({ label, details: { segment: snapshot.segment, inboundCount: snapshot.inboundCount, state: snapshot.state } });
                await activePage.screenshot({ path: join(options.output, `${label}.png`) });
            }
        });
        assertNoForeignPlayer(await observe(activePage));

        if (pageErrors) throw new Error('capture browser reported an uncaught error');
        stage = 'cache-drain';
        const pendingBefore = tap.diagnostics.pendingCounts;
        const drainDeadline = Date.now() + 30_000;
        while (true) {
            assertNoForeignPlayer(await observe(activePage));

            const diagnostics = tap.diagnostics;
            if (diagnostics.failures.length) throw new Error('capture tap failed before finalization');
            if (Object.values(diagnostics.pendingCounts).every(count => count === 0)) break;
            if (Date.now() >= drainDeadline) throw new Error('capture cache stream did not drain');
            await cycles(activePage, 1);
        }
        steps.push({ label: 'cache-drained', details: { pendingBefore, pendingAfter: tap.diagnostics.pendingCounts } });
        stage = 'finalization';
        assertNoForeignPlayer(await observe(activePage));
        await activeTap.finalize();
        assertNoForeignPlayer(await observe(activePage));
        assertCaptureFrames(options.scenario, tap.records, protocol);
        succeeded = true;
    } catch (error) {
        failure = error instanceof Error ? { name: error.name, ...(error.message.startsWith('capture ') ? { message: error.message } : {}) } : { name: 'UnknownFailure' };
        // A failed scene may contain another account. Retain only the allowlisted state, never a failure screenshot.
        if (page) failureState = await observe(page).catch(() => undefined);
    } finally {
        try {
            await browser?.close();
        } finally {
            try {
                await tap?.close();
            } finally {
                if (browserBuild) rmSync(browserBuild, { recursive: true, force: true });
            }
        }
        const receipt = {
            status: succeeded ? 'passed' : 'failed', scenario: options.scenario, accountPrefix: options.accountPrefix, account: username,
            clientCommit: options.clientCommit, contentCommit: options.contentCommit, stage, failure, failureState, pageErrors, steps,
            diagnostics: tap?.diagnostics,
            ...(succeeded ? { recording: basename(recordingPath), recordingSha256: await digest(recordingPath), cacheSha256: await digest(cachePath) } : {})
        };
        writeFileSync(join(options.output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    }
    if (!succeeded) throw new Error(`capture failed at ${stage}; inspect the receipt`);
    console.log(`capture passed: ${options.scenario}`);
}

if (import.meta.main) {
    try { await capture(options()); }
    catch (error) {
        // Never print arbitrary dependency errors, command arguments, key data, or login parameters.
        const message = error instanceof Error && error.message.startsWith('capture ') ? error.message : 'capture failed; no raw diagnostics were published';
        console.error(message);
        process.exitCode = 1;
    }
}
