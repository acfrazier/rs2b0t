import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import CollisionMap from '#/client/dash3d/CollisionMap.js';
import { CollisionFlag } from '#/client/dash3d/CollisionFlag.js';
import World from '#/client/dash3d/World.js';
import Model from '#/client/dash3d/Model.js';
import { Int32Array3d } from '#/client/util/Arrays.js';
import { ARCHIVES, type CacheBundle, type Protocol, type RecordingHeader, type RecordingRecord } from '../../tools/tap-377/format.js';
import { loadReplayCaches, loadReplayRecordings, type ReplayRecording } from './replay/recording.js';
import { readReplayCheckpoint, replayRecording } from './replay/runtime.js';

const hash = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');

function syntheticRecording(value: number): { recording: ReplayRecording; cache: CacheBundle } {
    const archives = {} as CacheBundle['archives'];
    const archiveHashes = {} as RecordingHeader['archiveHashes'];
    for (const name of ARCHIVES) {
        archives[name] = Buffer.from([value]).toString('base64');
        archiveHashes[name] = createHash('sha256').update(Uint8Array.of(value)).digest('hex');
    }
    const cache: CacheBundle = { format: 1, archives, ondemand: {} };
    const protocol: Protocol = {
        revision: 289, client: [{ name: 'NO_TIMEOUT', id: 1, length: 0 }],
        server: [{ name: 'ONE', id: 2, length: -1 }, { name: 'TWO', id: 3, length: -2 }, { name: 'LOGOUT', id: 4, length: 0 }]
    };
    const records: RecordingRecord[] = [
        { type: 'header', tapVersion: 1, revision: 289, engineCommit: 'a'.repeat(40), contentCommit: 'b'.repeat(40), clientCommit: 'c'.repeat(40), accountPrefix: 'frtap', archiveHashes, tickBasis: 'player-info' },
        { type: 'login', segment: 1, replies: [0, 2], reconnect: false, staffmodlevel: 0, mouseTracked: false },
        { type: 'frame', segment: 1, direction: 'in', ordinal: 1, tick: 0, bytes: '02010a' },
        { type: 'frame', segment: 1, direction: 'in', ordinal: 2, tick: 0, bytes: '04' },
        { type: 'end', segment: 1, reason: 'logout', inboundCount: 2, outboundCount: 0 }
    ];
    const recordingSha256 = hash(records.map(record => JSON.stringify(record)).join('\n') + '\n');
    const indexEntry = { file: `289/sample${value}.jsonl`, revision: 289, sha256: recordingSha256, cacheSha256: hash(JSON.stringify(cache)) };
    return { cache, recording: { records, recordingFile: indexEntry.file, indexEntry, protocol, recordingSha256 } };
}

describe('cache-free committed recording contract', () => {
    test('every indexed and committed 377 JSONL matches the P1 descriptors and its recording hash', () => {
        const recordings = loadReplayRecordings(377);
        const files = [...new Bun.Glob('377/**/*.jsonl').scanSync('test/io/recordings')].sort();
        expect(files.length).toBeGreaterThan(0);
        expect(recordings.map(recording => recording.recordingFile).sort()).toEqual(files);
        expect(recordings.some(recording => recording.records.some(record => record.type === 'checkpoint' && record.state.sceneInstanced))).toBe(true);
        expect(new Set(recordings.map(recording => recording.indexEntry.cacheSha256)).size).toBeGreaterThan(1);
    });

    test('each recording resolves its own hash-keyed cache and a missing later cache fails closed', () => {
        const directory = mkdtempSync(join(tmpdir(), 'replay-caches-'));
        const fixtures = [syntheticRecording(1), syntheticRecording(2)];
        try {
            for (const fixture of fixtures) writeFileSync(join(directory, `${fixture.recording.indexEntry.cacheSha256}.json`), JSON.stringify(fixture.cache));
            const loaded = loadReplayCaches(fixtures.map(fixture => fixture.recording), directory);
            expect(loaded).toHaveLength(2);
            for (let i = 0; i < fixtures.length; i++) {
                expect(loaded[i]!.cacheBundle).toEqual(fixtures[i]!.cache);
                expect(loaded[i]!.cacheSha256).toBe(fixtures[i]!.recording.indexEntry.cacheSha256);
            }
            rmSync(join(directory, `${fixtures[1]!.recording.indexEntry.cacheSha256}.json`));
            expect(() => loadReplayCaches(fixtures.map(fixture => fixture.recording), directory)).toThrow('replay cache bundle is not readable');
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test('missing cache locations redact host paths rather than exposing ENOENT', () => {
        const fixture = syntheticRecording(1);
        const missing = join(tmpdir(), 'absent-replay-cache', 'cache.json');
        const error = (() => {
            try { loadReplayCaches([fixture.recording], missing); }
            catch (error) { return error; }
            throw new Error('missing cache was accepted');
        })();
        expect(String(error)).toContain('replay cache location is not readable');
        expect(String(error)).not.toContain(tmpdir());
        expect(String(error)).not.toContain('ENOENT');
    });

    test('malformed -1 and -2 framing is rejected by replayRecording before boot', async () => {
        const { recording, cache } = syntheticRecording(1);
        for (const bytes of ['02', '02020a', '0300', '0300020a']) {
            const records = recording.records.map(record => record.type === 'frame' && record.ordinal === 1 ? { ...record, bytes } : record);
            await expect(replayRecording(records, cache, recording.protocol)).rejects.toThrow('frame-length');
        }
    });

    test('a corrupted indexed recording hash cannot be accepted', () => {
        const { recording, cache } = syntheticRecording(1);
        const directory = mkdtempSync(join(tmpdir(), 'replay-index-'));
        try {
            writeFileSync(join(directory, `${recording.indexEntry.cacheSha256}.json`), JSON.stringify(cache));
            expect(() => loadReplayCaches([{ ...recording, recordingSha256: '0'.repeat(64) }], directory)).toThrow('index-recording-hash');
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});

describe('non-vacuous replay scene checkpoints', () => {
    const adapter = {
        ingame: () => true, sceneState: () => 2,
        serverTile: () => ({ x: 3204, z: 3204, level: 0 }),
        mapBuildBase: () => ({ x: 3152, z: 3152 }),
        sceneInstanced: false
    };
    function scene() {
        const world = new World(new Int32Array3d(4, 105, 105), 104, 4, 104);
        return { world, collision: Array.from({ length: 4 }, () => new CollisionMap()), sceneInstanced: true };
    }
    function populateWorld(world: World): void {
        world.setGroundDecor(Object.create(Model.prototype) as Model, 0, 52, 52, 0, 1, 0);
    }

    test('allocated and base-filled worlds are not populated scenes', () => {
        const client = scene();
        expect(() => readReplayCheckpoint(client, adapter)).toThrow('no populated world or collision');
        client.world.fillBaseLevel(0);
        client.collision[0]!.blockGround(52, 52);
        expect(() => readReplayCheckpoint(client, adapter)).toThrow('no populated world or collision');
    });

    test('collision must be built on the active level in the player zone, not just at bounds or elsewhere', () => {
        const client = scene();
        populateWorld(client.world);
        expect(() => readReplayCheckpoint(client, adapter)).toThrow('no populated world or collision');
        client.collision[1]!.blockGround(52, 52);
        client.collision[0]!.blockGround(20, 20);
        client.collision[0]!.flags[CollisionMap.index(52, 52)] = CollisionFlag.UNLOADED;
        expect(() => readReplayCheckpoint(client, adapter)).toThrow('no populated world or collision');
        client.collision[0]!.flags[CollisionMap.index(52, 52)] = CollisionFlag._BOUNDS;
        expect(() => readReplayCheckpoint(client, adapter)).toThrow('no populated world or collision');
        client.collision[0]!.flags[CollisionMap.index(52, 52)] = 0;
        client.collision[0]!.blockGround(52, 52);
        expect(readReplayCheckpoint(client, adapter).sceneBuild).toEqual({ locCount: 1, collisionZoneTiles: 1 });
        client.collision[0]!.reset();
        expect(() => readReplayCheckpoint(client, adapter)).toThrow('no populated world or collision');
    });

    test('sceneInstanced comes from the client, never from a reader fallback', () => {
        const client = scene();
        populateWorld(client.world);
        client.collision[0]!.blockGround(52, 52);
        expect(readReplayCheckpoint(client, adapter).state.sceneInstanced).toBe(true);
        client.sceneInstanced = false;
        const lyingAdapter = { ...adapter, sceneInstanced: true };
        expect(readReplayCheckpoint(client, lyingAdapter).state.sceneInstanced).toBe(false);
        client.world.resetMap();
        expect(() => readReplayCheckpoint(client, adapter)).toThrow('no populated world or collision');
    });
});
