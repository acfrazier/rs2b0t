import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pageTemplatePath, simUnreachable } from '../../e2e/lib/harness.js';

describe('simUnreachable', () => {
    test('names the url and the two local sims when nothing answers', async () => {
        const fetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch')!;
        Object.defineProperty(globalThis, 'fetch', {
            configurable: true,
            value: async () => { throw new Error('ECONNREFUSED'); }
        });
        try {
            const why = await simUnreachable('http://127.0.0.1:1');
            expect(why).toContain('http://127.0.0.1:1/bot.html');
            expect(why).toContain('ECONNREFUSED');
            expect(why).toContain(':8890');
            expect(why).toContain(':8888');
        } finally {
            Object.defineProperty(globalThis, 'fetch', fetch);
        }
    });
});

describe('pageTemplatePath', () => {
    const withPublic = (files: string[], run: (dir: string) => void): void => {
        const dir = mkdtempSync(join(tmpdir(), 'rs2b0t-public-'));
        try {
            for (const file of files) writeFileSync(join(dir, file), '<html></html>');
            run(dir);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    };

    test('uses the engine page when it exists, with or without seeding', () => {
        withPublic(['bot.html'], dir => {
            expect(pageTemplatePath(dir, false)).toBe(`${dir}/bot.html`);
            expect(pageTemplatePath(dir, true)).toBe(`${dir}/bot.html`);
        });
    });

    test('a 377 engine with only rs2.html needs --seed-html to fall back to the repo template', () => {
        withPublic(['rs2.html'], dir => {
            expect(pageTemplatePath(dir, true)).toBe('public-bot/bot.html');
            expect(pageTemplatePath(dir, false)).toBe(`${dir}/bot.html`);
        });
    });
});
