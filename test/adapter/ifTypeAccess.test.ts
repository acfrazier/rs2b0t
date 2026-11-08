import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { attach, detach, reader } from '#/bot/adapter/ClientAdapter.js';
import { SELF_TEST } from '#/bot/adapter/RawClient.js';
import IfType from '#/client/config/IfType.js';

const originalInterfaces = IfType.list;

afterEach(() => {
    IfType.list = originalInterfaces;
    detach();
});

describe('IfType access', () => {
    test('the adapter reads IfType.list and does not call get or unloadCom', () => {
        const src = readFileSync('src/bot/adapter/ClientAdapter.ts', 'utf8');
        expect(src).not.toMatch(/IfType\.get\s*\(/);
        expect(src).not.toMatch(/\bunloadCom\b/);
        expect(src.match(/IfType\.list/g)?.length).toBeGreaterThan(20);
    });

    test('ifText still reads a component after a later list slot is filled', () => {
        const com = new IfType();
        com.id = 12;
        com.text = 'Welcome to RuneScape.';
        IfType.list = [];
        IfType.list[12] = com;
        expect(reader.ifText(12)).toBe('Welcome to RuneScape.');
        IfType.list[13] = new IfType();
        expect(reader.ifText(12)).toBe('Welcome to RuneScape.');
        expect(IfType.list[12]).toBe(com);
    });
});

describe('attach() list', () => {
    test('SELF_TEST includes the 377 instance members', () => {
        expect(SELF_TEST).toContain('sceneInstanced');
        expect(SELF_TEST).toContain('sceneMapRegion');
        expect(SELF_TEST).toContain('mapBuildBaseX');
        expect(SELF_TEST).toContain('var');
    });

    test('attach reports sceneInstanced and sceneMapRegion when they are absent', () => {
        const client: Record<string, unknown> = {};
        for (const name of SELF_TEST) {
            if (name !== 'sceneInstanced' && name !== 'sceneMapRegion') {
                client[name] = 0;
            }
        }
        const missing = attach(client);
        expect(missing).toContain('sceneInstanced');
        expect(missing).toContain('sceneMapRegion');
    });

    test('attach returns no missing names when every SELF_TEST member is present', () => {
        const client: Record<string, unknown> = {};
        for (const name of SELF_TEST) {
            client[name] = name === 'sceneInstanced' ? false : name === 'sceneMapRegion' ? [] : 0;
        }
        expect(attach(client)).toEqual([]);
    });
});
