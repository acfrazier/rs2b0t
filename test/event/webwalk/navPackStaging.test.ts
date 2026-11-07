import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';

import { navPackForWorker } from '#/bot/event/webwalk/navPack.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';

interface Artifact {
    path: string;
    kind: string;
    stagedPath?: string;
}
const realFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = realFetch;
});

const manifest = JSON.parse(readFileSync('data/manifest.json', 'utf8')) as { artifacts: Artifact[] };

function artifactPath(matches: (artifact: Artifact) => boolean): string {
    const artifact = manifest.artifacts.find(matches);
    if (!artifact) {
        throw new Error('required navigation artifact is absent from data/manifest.json');
    }
    return join(process.cwd(), artifact.stagedPath ?? artifact.path);
}

const packPath = artifactPath(artifact => artifact.path === 'out/collision.lcnav.gz');
const doorDataPath = artifactPath(artifact => artifact.path.endsWith('/webwalk/data/doors.json'));

test('Navigator pack loader reads and parses the staged 377 collision pack', async () => {
    const compressed = readFileSync(packPath);
    globalThis.fetch = (async () => new Response(compressed)) as unknown as typeof fetch;
    try {
        const { pack, transfer } = await navPackForWorker(new URL('https://nav-pack.test/collision.lcnav.gz'));
        expect(transfer).toHaveLength(1);
        expect(Buffer.compare(Buffer.from(new Uint8Array(pack)), compressed)).toBe(0);
        expect(new PathFinder(gunzipSync(new Uint8Array(pack))).mapsquares).toBeGreaterThan(0);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('real 377 pack refuses door IDs 73/74 and admits 1551/1553', () => {
    const finder = new PathFinder(gunzipSync(readFileSync(packPath)));
    expect(finder.mapsquares).toBeGreaterThan(0);

    const doors = JSON.parse(readFileSync(doorDataPath, 'utf8')) as { locId: number }[];
    const admitted = new Set(doors.map(door => door.locId));
    expect(admitted.has(73)).toBe(false);
    expect(admitted.has(74)).toBe(false);
    expect(admitted.has(1551)).toBe(true);
    expect(admitted.has(1553)).toBe(true);
});
