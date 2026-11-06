import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ENTRIES = ['client', 'mapview', 'ondemandworker', 'botclient', 'multibox', 'navworker'];
const TAP_MARKERS = ['tap-377', 'TAP_VERSION', 'RecordingHeader', 'startTap', 'capture-session'];

function files(root: string): string[] {
    return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
        const path = join(root, entry.name);
        return entry.isDirectory() ? files(path) : [path];
    });
}

export function containsTap(text: string): boolean {
    return TAP_MARKERS.some(marker => text.includes(marker));
}

describe('development-only session tap', () => {
    test('the guard rejects both code and source-map references', () => {
        expect(containsTap('import { startTap } from "./tools/tap-377/proxy.js"')).toBe(true);
        expect(containsTap(JSON.stringify({ sources: ['../../tools/tap-377/format.ts'] }))).toBe(true);
        expect(containsTap('function mainloop() {}')).toBe(false);
    });

    test('product source never references the recording tools', () => {
        for (const file of files('src').filter(path => /\.[cm]?[jt]s$/.test(path))) {
            expect(containsTap(readFileSync(file, 'utf8')), file).toBe(false);
        }
    });

    test('every browser and worker bundle excludes the tap, including source maps', () => {
        for (const entry of ENTRIES) {
            for (const suffix of ['.js', '.js.map']) {
                const path = `out/${entry}${suffix}`;
                expect(existsSync(path), `Build all targets before testing: ${path}`).toBe(true);
                expect(containsTap(readFileSync(path, 'utf8')), path).toBe(false);
            }
        }
        const record = JSON.parse(readFileSync('out/build-targets.json', 'utf8')) as { targets: string[]; outputs: string[] };
        expect(record.targets).toEqual(['local', 'prod']);
        for (const output of record.outputs.filter(path => /\.js(?:\.map)?$/.test(path))) {
            expect(containsTap(readFileSync(output, 'utf8')), output).toBe(false);
        }
    });
});
