import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

test('desktop disables process-level throttling before startup and adds no feature flags', () => {
    const switches = new Map<string, string>();
    runInNewContext(readFileSync(new URL('../../desktop/main.cjs', import.meta.url), 'utf8'), {
        __dirname: '/desktop',
        require: (name: string) => {
            if (name === 'node:path') return { join };
            if (name === './storage-session.cjs') return { prepareStorage: () => ({}) };
            if (name !== 'electron') throw new Error(`Unexpected module: ${name}`);
            return {
                app: {
                    commandLine: { appendSwitch: (key: string, value = '') => switches.set(key, value) },
                    whenReady: () => new Promise(() => {}),
                    on: () => {}
                }
            };
        }
    });
    expect([...switches.keys()].sort()).toEqual(['disable-background-timer-throttling', 'disable-backgrounding-occluded-windows', 'disable-renderer-backgrounding']);
});
