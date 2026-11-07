import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, spyOn, test } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright-core';

import { capture } from '../../e2e/tap-377/capture-session.js';
import * as pageModule from '../../e2e/tap-377/capture-page.js';
import * as scenarioModule from '../../e2e/tap-377/capture-scenarios.js';
import * as keyModule from '../../e2e/lib/engineLoginKey.js';
import * as protocolModule from '../../tools/tap-377/protocol.js';
import * as tapModule from '../../tools/tap-377/tap.js';

for (const outcome of ['success', 'build-failure', 'foreign-after-scenario', 'foreign-after-finalize'] as const) {
    test(`capture cleans temporary browser files and checks final observers: ${outcome}`, async () => {
        const root = mkdtempSync(join(tmpdir(), 'frtap-capture-test-'));
        const output = join(root, 'evidence');
        let build = '', finalized = false, scenarioDone = false, browserClosed = false, tapClosed = false;
        const snapshot: pageModule.CaptureSnapshot = {
            state: { serverTile: { x: 3200, z: 3200, level: 0 }, sceneState: 2, ingame: true, sceneInstanced: false, mapBuildBaseX: 3152, mapBuildBaseZ: 3152 },
            cycle: 100, tick: 10, inboundCount: 0, segment: 1, moving: false, remaining: 0,
            main: -1, chat: -1, side: -1, countDialog: false, bankArrangeMode: 0, foreignPlayer: false, packetFailure: false
        };
        const page = { on() {}, async goto() {} } as unknown as Page;
        const browser = { async newPage() { return page; }, async close() { browserClosed = true; } } as unknown as Browser;
        const tap = {
            url: 'http://127.0.0.1:1/', records: [], diagnostics: { failures: [], pendingCounts: { game: 0 } },
            async finalize() {
                finalized = true;
                writeFileSync(join(output, 'reference.jsonl'), 'synthetic recording');
                writeFileSync(join(output, 'cache.json'), 'synthetic cache');
            },
            async close() { tapClosed = true; }
        } as unknown as tapModule.TapSession;
        const spies = [
            spyOn(protocolModule, 'loadEngineProtocol').mockReturnValue({ revision: 289, client: [], server: [{ name: 'PLAYER_INFO', id: 1, length: -2 }] }),
            spyOn(keyModule, 'engineLoginKey').mockReturnValue({ rsae: '65537', rsan: '65537' }),
            spyOn(Bun, 'spawn').mockImplementation((...args: unknown[]) => {
                // The overloaded spawn signature loses its options type in this spy.
                const options = args[1] as { env: Record<string, string> };
                build = options.env?.B0T_OUT_DIR ?? '';
                if (!build) throw new Error('capture did not supply a temporary build directory');
                writeFileSync(join(build, 'partial.js'), 'synthetic public key parameters');
                return { exited: Promise.resolve(outcome === 'build-failure' ? 1 : 0) } as Bun.Subprocess;
            }),
            spyOn(tapModule, 'startTap').mockResolvedValue(tap),
            spyOn(chromium, 'launch').mockResolvedValue(browser),
            spyOn(pageModule, 'installObserver').mockResolvedValue(undefined),
            spyOn(pageModule, 'observe').mockImplementation(async () => ({
                ...snapshot,
                foreignPlayer: (outcome === 'foreign-after-scenario' && scenarioDone) || (outcome === 'foreign-after-finalize' && finalized)
            })),
            spyOn(scenarioModule, 'captureScenario').mockImplementation(async () => { scenarioDone = true; }),
            spyOn(scenarioModule, 'assertCaptureFrames').mockImplementation(() => {})
        ];
        try {
            const run = capture({
                engineDir: root, origin: 'http://127.0.0.1:1', scenario: 'reference', output, accountPrefix: 'frtap',
                clientCommit: 'a'.repeat(40), contentCommit: 'b'.repeat(40), headless: true
            });
            if (outcome === 'success') await run;
            else await expect(run).rejects.toThrow('capture failed');
            expect(build.length).toBeGreaterThan(0);
            expect(build.startsWith(output)).toBe(false);
            expect(existsSync(build)).toBe(false);
            const receipt = JSON.parse(readFileSync(join(output, 'receipt.json'), 'utf8'));
            expect(receipt.status).toBe(outcome === 'success' ? 'passed' : 'failed');
            expect(finalized).toBe(outcome === 'success' || outcome === 'foreign-after-finalize');
            if (outcome !== 'build-failure') {
                expect(browserClosed).toBe(true);
                expect(tapClosed).toBe(true);
            }
        } finally {
            for (const spy of spies.reverse()) spy.mockRestore();
            if (build) rmSync(build, { recursive: true, force: true });
            rmSync(root, { recursive: true, force: true });
        }
    });
}
