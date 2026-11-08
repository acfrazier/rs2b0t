import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { LoopingBot } from '#/bot/api/bot/Bot.js';
import { attach, detach } from '#/bot/adapter/ClientAdapter.js';
import { createRosterClient } from '#/bot/panel/RosterClient.js';
import BotPanel from '#/bot/panel/BotPanel.js';
import { BotHost } from '#/bot/runtime/BotHost.js';
import { RecoveryHints } from '#/bot/runtime/RecoveryHints.js';
import { RunManager } from '#/bot/runtime/RunManager.js';
import { ScriptRegistry, type ScriptMeta } from '#/bot/runtime/ScriptRegistry.js';
import { ScriptRunner, scriptAdmissionReason } from '#/bot/runtime/ScriptRunner.js';
import { StallGuard } from '#/bot/runtime/StallGuard.js';
import { CLIENT_VERSION } from '#/client/io/ClientProt.js';
import { TARGET, resolveTarget } from '#/client/config/target.js';
import '#/bot/scripts/index.js';

const FIXTURE_NAME = 'ScriptAdmissionFixture';
const QUALIFIED_NAME = 'ScriptAdmissionQualified';
const OLD_REVISION = 289;

const PLAIN_URL = 'http://localhost:8081/bot.html';
const previousTarget = { ...TARGET };

class AdmissionProbeBot extends LoopingBot {
    override loop(): void {}
}

let fixtureName: string | null = null;
let previousMeta: ScriptMeta | undefined;
let root: HTMLDivElement;

function setURL(url: string): void {
    Reflect.get(window, 'happyDOM').setURL(url);
}

function registerFixture(name: string, revision: number): { meta: ScriptMeta; creations: { count: number } } {
    fixtureName = name;
    previousMeta = ScriptRegistry.get(name);
    const creations = { count: 0 };
    const meta: ScriptMeta = {
        name,
        description: 'script admission test fixture',
        revision,
        create: () => {
            creations.count++;
            return new AdmissionProbeBot();
        }
    };
    ScriptRegistry.register(meta);
    return { meta, creations };
}

function createPanel(selectedScript: string): BotPanel {
    localStorage.setItem('rs2b0t:selectedScript', selectedScript);
    root = document.createElement('div');
    document.body.append(root);
    const host = { selfTestMissing: [], addDrawListener: () => {} } as unknown as typeof BotHost;
    return new BotPanel(root, host);
}

async function settle(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

beforeEach(async () => {
    ScriptRunner.stop('admission test setup');
    await settle();
    detach();
    RunManager.override(null);
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
    delete TARGET.world;
    delete TARGET.httpPrefix;
    Object.assign(TARGET, resolveTarget('local', 'localhost:8081'));
    Reflect.get(window, 'happyDOM').setURL('http://localhost:8081/bot.html');
    fixtureName = null;
    previousMeta = undefined;
});

afterEach(async () => {
    mock.restore();
    ScriptRunner.stop('admission test teardown');
    await settle();
    detach();
    RunManager.override(null);
    RecoveryHints.pendingRecovery = false;
    if (fixtureName) {
        ScriptRegistry.unregister(fixtureName);
        if (previousMeta) ScriptRegistry.register(previousMeta);
    }
    localStorage.clear();
    sessionStorage.clear();
    setURL(PLAIN_URL);
    delete TARGET.world;
    delete TARGET.httpPrefix;
    Object.assign(TARGET, previousTarget);
});

test('all 76 bundled scripts target revision 289', () => {
    const scripts = ScriptRegistry.list();
    expect(scripts).toHaveLength(76);
    expect(scripts.every(meta => meta.revision === OLD_REVISION)).toBe(true);
});

test('the panel refuses an unqualified script and shows the reason', () => {
    const { meta, creations } = registerFixture(FIXTURE_NAME, OLD_REVISION);
    createPanel(meta.name);
    const context = ScriptRunner.ctx;
    const runOverride = spyOn(RunManager, 'override');
    const warning = spyOn(console, 'warn').mockImplementation(() => {});
    spyOn(console, 'error').mockImplementation(() => {});

    Array.from(root.querySelectorAll('button')).find(button => button.textContent === 'Start')!.click();

    const reason = scriptAdmissionReason(meta)!;
    expect(ScriptRunner.ctx).toBe(context);
    expect(creations.count).toBe(0);
    expect(runOverride).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(`[rs2b0t] ${reason}`);
    expect(root.querySelector('.rs2b0t-admission-warning')?.textContent).toContain(reason);
    expect(Array.from(root.querySelectorAll('button')).some(button => button.textContent === 'Run unqualified' && !button.hidden)).toBe(true);
});

test('the harness roster API refuses an unqualified script', () => {
    const { meta, creations } = registerFixture(FIXTURE_NAME, OLD_REVISION);
    const panel = createPanel(meta.name);
    const client = createRosterClient(panel);
    const context = ScriptRunner.ctx;
    const runOverride = spyOn(RunManager, 'override');
    const warning = spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => client.startScript()).toThrow(scriptAdmissionReason(meta)!);

    expect(ScriptRunner.ctx).toBe(context);
    expect(creations.count).toBe(0);
    expect(runOverride).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(`[rs2b0t] ${scriptAdmissionReason(meta)}`);
});

test('saved-profile configuration cannot start an unqualified script', async () => {
    const { meta, creations } = registerFixture('JiveRC', OLD_REVISION);
    const panel = createPanel(meta.name);
    const client = createRosterClient(panel);
    const context = ScriptRunner.ctx;
    const runOverride = spyOn(RunManager, 'override');
    const warning = spyOn(console, 'warn').mockImplementation(() => {});

    await expect(client.configureScript(meta.name, null, true)).rejects.toThrow(scriptAdmissionReason(meta)!);

    expect(ScriptRunner.ctx).toBe(context);
    expect(creations.count).toBe(0);
    expect(runOverride).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(`[rs2b0t] ${scriptAdmissionReason(meta)}`);
});

test('WalkTo refuses an unqualified script', async () => {
    const original = ScriptRegistry.get('WalkTo')!;
    const creations = { count: 0 };
    const meta: ScriptMeta = {
        ...original,
        revision: OLD_REVISION,
        create: () => {
            creations.count++;
            return new AdmissionProbeBot();
        }
    };
    fixtureName = 'WalkTo';
    previousMeta = original;
    ScriptRegistry.register(meta);
    const panel = createPanel(meta.name);
    attach({ ingame: true });
    const context = ScriptRunner.ctx;
    const runOverride = spyOn(RunManager, 'override');
    const warning = spyOn(console, 'warn').mockImplementation(() => {});

    await expect(panel.travelTo('Lumbridge')).rejects.toThrow(scriptAdmissionReason(meta)!);

    expect(ScriptRunner.ctx).toBe(context);
    expect(creations.count).toBe(0);
    expect(runOverride).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(`[rs2b0t] ${scriptAdmissionReason(meta)}`);
});

test('StallGuard refuses an unqualified recovery restart', async () => {
    const { meta, creations } = registerFixture(FIXTURE_NAME, CLIENT_VERSION);
    ScriptRunner.start(meta);
    await settle();
    expect(ScriptRunner.state).toBe('running');
    meta.revision = OLD_REVISION;
    ScriptRunner.stop('prepare recovery restart');
    expect(ScriptRunner.state).toBe('stopped');

    RunManager.override({ runAuto: false });
    const runOverride = spyOn(RunManager, 'override');
    const warning = spyOn(console, 'warn').mockImplementation(() => {});
    spyOn(console, 'error').mockImplementation(() => {});
    const context = ScriptRunner.ctx;
    StallGuard.enable();
    StallGuard.requestRestart('admission test');
    BotHost.onFrame();

    expect(ScriptRunner.ctx).toBe(context);
    expect(ScriptRunner.state).toBe('stopped');
    expect(creations.count).toBe(1);
    expect(runOverride).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(`[rs2b0t] ${scriptAdmissionReason(meta)}`);
});

test('the visible override starts an unqualified script and logs a warning', async () => {
    const { meta, creations } = registerFixture(FIXTURE_NAME, OLD_REVISION);
    createPanel(meta.name);
    const button = Array.from(root.querySelectorAll('button')).find(item => item.textContent === 'Run unqualified')!;

    expect(button.hidden).toBe(false);
    button.click();
    await settle();

    expect(creations.count).toBe(1);
    expect(ScriptRunner.meta).toBe(meta);
    expect(ScriptRunner.ctx?.log.some(line => line.level === 'warn' && line.msg.includes('running unqualified'))).toBe(true);
});

test('a script qualified for this client starts normally', async () => {
    const { meta, creations } = registerFixture(QUALIFIED_NAME, CLIENT_VERSION);
    createPanel(meta.name);

    const warning = spyOn(console, 'warn').mockImplementation(() => {});
    const button = Array.from(root.querySelectorAll('button')).find(item => item.textContent === 'Start')!;
    button.click();
    await settle();

    expect(creations.count).toBe(1);
    expect(ScriptRunner.meta).toBe(meta);
    expect(ScriptRunner.state).toBe('running');
    expect(root.querySelector<HTMLElement>('.rs2b0t-admission-warning')?.hidden).toBe(true);
    expect(warning).not.toHaveBeenCalled();
});
