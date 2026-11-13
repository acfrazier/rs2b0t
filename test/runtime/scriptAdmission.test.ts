import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { LoopingBot } from '#/bot/api/bot/Bot.js';
import { ScriptActivity } from '#/bot/runtime/ScriptActivity.js';
import { attach, detach } from '#/bot/adapter/ClientAdapter.js';
import { createRosterClient } from '#/bot/panel/RosterClient.js';
import BotPanel from '#/bot/panel/BotPanel.js';
import { BotHost } from '#/bot/runtime/BotHost.js';
import { SettingsStore } from '#/bot/runtime/Settings.js';
import { RecoveryHints } from '#/bot/runtime/RecoveryHints.js';
import { RunManager } from '#/bot/runtime/RunManager.js';
import { ScriptRegistry, type ScriptMeta } from '#/bot/runtime/ScriptRegistry.js';
import { ScriptRunner, scriptAdmissionReason } from '#/bot/runtime/ScriptRunner.js';
import { StallGuard } from '#/bot/runtime/StallGuard.js';
import { CLIENT_VERSION } from '#/client/io/ClientProt.js';
import { TARGET, resolveTarget } from '#/client/config/target.js';
import Tile from '#/bot/geometry/Tile.js';
import '#/bot/scripts/index.js';

const FIXTURE_NAME = 'ScriptAdmissionFixture';
const QUALIFIED_NAME = 'ScriptAdmissionQualified';
const OLD_REVISION = 289;

const PLAIN_URL = 'http://localhost:8081/bot.html';
const previousTarget = { ...TARGET };

class AdmissionProbeBot extends LoopingBot {
    override loop(): void {}
}

let previousMetas = new Map<string, ScriptMeta | undefined>();
let root: HTMLDivElement;

function setURL(url: string): void {
    Reflect.get(window, 'happyDOM').setURL(url);
}

function registerMeta(meta: ScriptMeta): void {
    if (!previousMetas.has(meta.name)) previousMetas.set(meta.name, ScriptRegistry.get(meta.name));
    ScriptRegistry.register(meta);
}

function registerFixture(name: string, revision: number, settingsSchema?: ScriptMeta['settingsSchema']): { meta: ScriptMeta; creations: { count: number } } {
    const creations = { count: 0 };
    const meta: ScriptMeta = {
        name,
        description: 'script admission test fixture',
        revision,
        ...(settingsSchema ? { settingsSchema } : {}),
        create: () => {
            creations.count++;
            return new AdmissionProbeBot();
        }
    };
    registerMeta(meta);
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
    RecoveryHints.clear();
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
    delete TARGET.world;
    delete TARGET.httpPrefix;
    Object.assign(TARGET, resolveTarget('local', 'localhost:8081'));
    Reflect.get(window, 'happyDOM').setURL('http://localhost:8081/bot.html');
    previousMetas = new Map();
});

afterEach(async () => {
    mock.restore();
    ScriptRunner.stop('admission test teardown');
    await settle();
    detach();
    RunManager.override(null);
    for (const [name, meta] of previousMetas) {
        ScriptRegistry.unregister(name);
        if (meta) ScriptRegistry.register(meta);
    }
    previousMetas.clear();
    localStorage.clear();
    sessionStorage.clear();
    setURL(PLAIN_URL);
    delete TARGET.world;
    delete TARGET.httpPrefix;
    Object.assign(TARGET, previousTarget);
});

/** Scripts an L2 live cell qualified on 377 (RS2B0T-377-L2); every other bundled script still targets 289. */
const L2_QUALIFIED = ['BoneBurier'];

test('bundled scripts target revision 289 except the L2-qualified set', () => {
    const scripts = ScriptRegistry.list();
    expect(scripts).toHaveLength(77);
    for (const meta of scripts) {
        expect({ name: meta.name, revision: meta.revision }).toEqual({ name: meta.name, revision: L2_QUALIFIED.includes(meta.name) ? CLIENT_VERSION : OLD_REVISION });
    }
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

test('saved-profile admission refusal preserves the active run, selection, and settings', async () => {
    const { meta, creations } = registerFixture('JiveRC', OLD_REVISION, {
        mode: { type: 'string', default: 'Auto' }
    });
    const active = registerFixture(QUALIFIED_NAME, CLIENT_VERSION);
    const panel = createPanel('WalkTo');
    ScriptRunner.start(active.meta);
    await settle();
    const context = ScriptRunner.ctx;
    SettingsStore.save('JiveRC', 'mode', 'Existing');
    SettingsStore.save('JiveRC', 'stale', 'Preserve');
    const settingsBefore = {
        mode: SettingsStore.saved('JiveRC', 'mode'),
        stale: SettingsStore.saved('JiveRC', 'stale')
    };
    RunManager.override({ runAuto: false });
    const runOverride = spyOn(RunManager, 'override');
    const warning = spyOn(console, 'warn').mockImplementation(() => {});
    const settingsSave = spyOn(SettingsStore, 'save');
    RecoveryHints.pendingRecovery = true;
    RecoveryHints.anchor = new Tile(12, 34);

    await expect(panel.configureScript(meta.name, { mode: 'New' }, true)).rejects.toThrow(scriptAdmissionReason(meta)!);

    expect(ScriptRunner.ctx).toBe(context);
    expect(ScriptRunner.state).toBe('running');
    expect(active.creations.count).toBe(1);
    expect(creations.count).toBe(0);
    expect(panel.selectedScriptName()).toBe('WalkTo');
    expect(localStorage.getItem('rs2b0t:selectedScript')).toBe('WalkTo');
    expect(sessionStorage.getItem('rs2b0t:selectedScript')).toBeNull();
    expect(SettingsStore.saved('JiveRC', 'mode')).toBe('Existing');
    expect(SettingsStore.saved('JiveRC', 'stale')).toBe('Preserve');
    expect(SettingsStore.saved('JiveRC', 'mode')).toBe(settingsBefore.mode);
    expect(SettingsStore.saved('JiveRC', 'stale')).toBe(settingsBefore.stale);
    expect(settingsSave).not.toHaveBeenCalled();
    expect(RecoveryHints.pendingRecovery).toBe(false);
    expect(RecoveryHints.anchor).toBeNull();
    expect(runOverride).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(`[rs2b0t] ${scriptAdmissionReason(meta)}`);
});

test('WalkTo admission refusal preserves the active run, selection, and settings', async () => {
    const { meta, creations } = registerFixture('WalkTo', OLD_REVISION);
    const active = registerFixture(QUALIFIED_NAME, CLIENT_VERSION);
    const panel = createPanel('JiveRC');
    attach({ ingame: true });
    ScriptRunner.start(active.meta);
    await settle();
    const context = ScriptRunner.ctx;
    SettingsStore.save('WalkTo', 'destination', 'Existing destination');
    SettingsStore.save('WalkTo', 'customTile', '4,5,0');
    const settingsBefore = {
        destination: SettingsStore.saved('WalkTo', 'destination'),
        customTile: SettingsStore.saved('WalkTo', 'customTile')
    };
    RunManager.override({ runAuto: false });
    const runOverride = spyOn(RunManager, 'override');
    const warning = spyOn(console, 'warn').mockImplementation(() => {});
    RecoveryHints.pendingRecovery = true;
    RecoveryHints.anchor = new Tile(56, 78);
    const settingsSave = spyOn(SettingsStore, 'save');

    await expect(panel.travelTo('Lumbridge')).rejects.toThrow(scriptAdmissionReason(meta)!);

    expect(ScriptRunner.ctx).toBe(context);
    expect(ScriptRunner.state).toBe('running');
    expect(active.creations.count).toBe(1);
    expect(creations.count).toBe(0);
    expect(panel.selectedScriptName()).toBe('JiveRC');
    expect(localStorage.getItem('rs2b0t:selectedScript')).toBe('JiveRC');
    expect(sessionStorage.getItem('rs2b0t:selectedScript')).toBeNull();
    expect(SettingsStore.saved('WalkTo', 'destination')).toBe(settingsBefore.destination);
    expect(SettingsStore.saved('WalkTo', 'customTile')).toBe(settingsBefore.customTile);
    expect(settingsSave).not.toHaveBeenCalled();
    expect(RecoveryHints.pendingRecovery).toBe(false);
    expect(RecoveryHints.anchor).toBeNull();
    expect(runOverride).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(`[rs2b0t] ${scriptAdmissionReason(meta)}`);
});

test('an unqualified activity requires the active parent run override', async () => {
    const { meta, creations } = registerFixture('AdmissionChild', OLD_REVISION);
    const refusalLogs: string[] = [];
    const warning = spyOn(console, 'warn').mockImplementation(() => {});
    RecoveryHints.pendingRecovery = true;
    RecoveryHints.anchor = new Tile(90, 12);
    const refused = new ScriptActivity(message => refusalLogs.push(message));
    const reason = scriptAdmissionReason(meta)!;

    await expect(refused.start(meta, {})).rejects.toThrow(reason);

    expect(creations.count).toBe(0);
    expect(refused.child).toBeNull();
    expect(refused.outcome).toBeNull();
    expect(refusalLogs).toContain(`[rs2b0t] ${reason}`);
    expect(RecoveryHints.pendingRecovery).toBe(false);
    expect(RecoveryHints.anchor).toBeNull();
    expect(warning).toHaveBeenCalledWith(`[rs2b0t] ${reason}`);

    const parent = registerFixture('AdmissionParent', OLD_REVISION);
    ScriptRunner.start(parent.meta, { runUnqualified: true });
    await settle();
    expect(ScriptRunner.allowsUnqualifiedChildren).toBe(true);
    const inheritedLogs: string[] = [];
    const inherited = new ScriptActivity(message => inheritedLogs.push(message));
    await inherited.start(meta, {});
    expect(creations.count).toBe(1);
    expect(inheritedLogs.some(message => message.includes('Warning: running unqualified'))).toBe(true);
    inherited.stop();

    ScriptRunner.stop('end override parent');
    await settle();
    expect(ScriptRunner.allowsUnqualifiedChildren).toBe(false);
    const laterLogs: string[] = [];
    const later = new ScriptActivity(message => laterLogs.push(message));
    await expect(later.start(meta, {})).rejects.toThrow(reason);
    expect(creations.count).toBe(1);
    expect(later.child).toBeNull();
    expect(laterLogs).toContain(`[rs2b0t] ${reason}`);
});

test('StallGuard refuses an unqualified recovery restart without leaving recovery state armed', async () => {
    const { meta, creations } = registerFixture(FIXTURE_NAME, OLD_REVISION);
    ScriptRunner.start(meta, { runUnqualified: true });
    await settle();
    expect(ScriptRunner.state).toBe('running');
    expect(ScriptRunner.allowsUnqualifiedChildren).toBe(true);
    ScriptRunner.stop('prepare recovery restart');
    expect(ScriptRunner.state).toBe('stopped');
    expect(ScriptRunner.allowsUnqualifiedChildren).toBe(false);
    RecoveryHints.anchor = new Tile(123, 456);

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
    expect(ScriptRunner.allowsUnqualifiedChildren).toBe(false);
    expect(RecoveryHints.pendingRecovery).toBe(false);
    expect(RecoveryHints.anchor).toBeNull();
    expect(runOverride).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(`[rs2b0t] ${scriptAdmissionReason(meta)}`);

    const panel = createPanel(meta.name);
    panel.startSelectedScript();
    expect(ScriptRunner.state).toBe('stopped');
    expect(creations.count).toBe(1);
    expect(RecoveryHints.pendingRecovery).toBe(false);
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
